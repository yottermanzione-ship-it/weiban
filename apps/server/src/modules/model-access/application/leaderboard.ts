/** 官方 Arena 数据集六小时同步；完整分页校验后原子替换，失败保留有效快照。 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { LeaderboardSnapshotStatus } from '@weiban/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type JobQueue,
} from '../../../platform/index.js';
import {
  bestArenaRanks,
  normalizeArenaName,
  parseLeaderboard,
  relativeRanks,
  suggestArenaNames,
  type LeaderboardEntry,
} from '../domain/leaderboard.js';
import { fetchArenaDataset, type ArenaDataset } from '../infra/arena-dataset.js';
import { modelAccessSettings, modelCatalog } from '../infra/db/schema.js';
import { CatalogService, LEADERBOARD_SNAPSHOT_KEY, type LeaderboardSnapshot } from './catalog.js';

export const REFRESH_LEADERBOARD_JOB = 'model_access.refresh_leaderboard';
export type LeaderboardFetcher = (url: string) => Promise<ArenaDataset>;
export const defaultLeaderboardFetcher: LeaderboardFetcher = async () => fetchArenaDataset();
export const LEADERBOARD_FETCHER = Symbol('weiban.model-access.leaderboard-fetcher');
const LOCK_ID = 7261022;
const REFRESH_LEASE_KEY = 'leaderboard_refresh_lease';
// 官方抓取总时限为八分钟；十分钟租约容纳保存，进程退出后也能自动恢复。
const REFRESH_LEASE_MS = 10 * 60_000;
interface RefreshLease {
  token: string;
  expiresAt: string;
}

@Injectable()
export class LeaderboardService implements OnModuleInit {
  private readonly logger = new Logger('Leaderboard');
  private pending: Promise<LeaderboardSnapshotStatus> | null = null;
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(LEADERBOARD_FETCHER) private readonly fetcher: LeaderboardFetcher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work<{ adminId?: string }>(REFRESH_LEADERBOARD_JOB, async (job) => {
      await this.refresh(job.data?.adminId ?? null);
    });
    await this.jobs.schedule(REFRESH_LEADERBOARD_JOB, '20 */6 * * *', { tz: 'Asia/Shanghai' });
  }

  async status(): Promise<LeaderboardSnapshotStatus> {
    const source = await this.catalog.leaderboardSource();
    const snapshot = await this.catalog.leaderboardSnapshot();
    const byName = bestArenaRanks(snapshot?.entries ?? []);
    const rows = (
      await this.database.db
        .select({
          modelKey: modelCatalog.modelKey,
          displayName: modelCatalog.displayName,
          upstreamModelId: modelCatalog.upstreamModelId,
          arenaModelName: modelCatalog.arenaModelName,
          sortOrder: modelCatalog.sortOrder,
        })
        .from(modelCatalog)
        .where(and(eq(modelCatalog.enabled, true), isNull(modelCatalog.deletedAt)))
    ).sort((a, b) => a.sortOrder - b.sortOrder || a.modelKey.localeCompare(b.modelKey));
    const matchedRank = (name: string | null) =>
      name ? (byName.get(normalizeArenaName(name)) ?? null) : null;
    // 手动指定优先；没填就用模型显示名 / 上游模型名，管理员不需要逐条维护。
    const rankOfRow = (r: (typeof rows)[number]) =>
      matchedRank(r.arenaModelName) ?? matchedRank(r.displayName) ?? matchedRank(r.upstreamModelId);
    const effectiveName = (r: (typeof rows)[number], rank: number) =>
      matchedRank(r.arenaModelName) !== null
        ? r.arenaModelName!
        : matchedRank(r.displayName) !== null
          ? r.displayName
          : (r.upstreamModelId ?? String(rank));
    const relative = relativeRanks(rows.map((r) => ({ key: r.modelKey, rank: rankOfRow(r) })));
    const matched: LeaderboardSnapshotStatus['matched'] = [];
    const unmatched: LeaderboardSnapshotStatus['unmatched'] = [];
    for (const r of rows) {
      const rank = rankOfRow(r);
      if (rank !== null)
        matched.push({
          modelKey: r.modelKey,
          displayName: r.displayName,
          arenaModelName: effectiveName(r, rank),
          rank,
          relativeRank: relative.get(r.modelKey)!,
        });
      else
        unmatched.push({
          modelKey: r.modelKey,
          displayName: r.displayName,
          arenaModelName: r.arenaModelName ?? null,
          suggestions: suggestArenaNames(
            r.displayName || r.upstreamModelId,
            snapshot?.entries ?? [],
            3,
          ),
        });
    }
    matched.sort((a, b) => a.relativeRank - b.relativeRank);
    return {
      source,
      snapshot:
        snapshot?.fetchedAt && snapshot.method
          ? {
              fetchedAt: snapshot.fetchedAt,
              method: snapshot.method,
              entries: snapshot.entries.length,
              publishedAt: snapshot.publishedAt ?? null,
              sourceUrl: snapshot.sourceUrl,
              totalRows: snapshot.totalRows ?? null,
            }
          : null,
      lastAttemptAt: snapshot?.lastAttemptAt ?? null,
      lastError: snapshot?.lastError ?? null,
      matched,
      unmatched,
    };
  }

  /**
   * 3.36：后台「榜单匹配」手动指定 / 清除模型的榜单对应名称。
   * null = 改回默认（用模型显示名 / 上游模型名自动匹配）。只影响展示排名，不改价格、扣费。
   */
  async updateArenaName(
    adminId: string,
    modelKey: string,
    arenaModelName: string | null,
  ): Promise<LeaderboardSnapshotStatus> {
    const [row] = await this.database.db
      .select({ modelKey: modelCatalog.modelKey })
      .from(modelCatalog)
      .where(and(eq(modelCatalog.modelKey, modelKey), isNull(modelCatalog.deletedAt)));
    if (!row) throw new AppError('not_found', '模型不存在或已删除', { status: 404 });
    await this.database.transaction(async (tx) => {
      await tx.db
        .update(modelCatalog)
        .set({ arenaModelName, updatedAt: this.clock.now() })
        .where(eq(modelCatalog.modelKey, modelKey));
      await this.audit.record(
        {
          module: 'model_access',
          action: 'catalog.arena_name_updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'model_catalog',
          targetId: modelKey,
          details: { arenaModelName },
        },
        tx,
      );
    });
    return this.status();
  }

  /** 分页同步超过 HTTP 超时；手动刷新投递持久队列，后台轮询状态。 */
  async requestRefresh(adminId: string): Promise<LeaderboardSnapshotStatus> {
    const snapshot = await this.catalog.leaderboardSnapshot();
    if (snapshot?.lastAttemptAt && this.clock.nowMs() - Date.parse(snapshot.lastAttemptAt) < 60_000)
      throw new AppError('bad_request', '刚刚已刷新过，请一分钟后再试', { status: 429 });
    await this.jobs.send(
      REFRESH_LEADERBOARD_JOB,
      { adminId },
      { singletonKey: 'official-arena', retryLimit: 0 },
    );
    return this.status();
  }

  /** 同进程合并刷新；持久租约保证跨实例互斥，抓取期间不占数据库事务或连接。 */
  refresh(adminId: string | null): Promise<LeaderboardSnapshotStatus> {
    if (this.pending) return this.pending;
    this.pending = this.refreshOnce(adminId).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refreshOnce(adminId: string | null): Promise<LeaderboardSnapshotStatus> {
    const source = await this.catalog.leaderboardSource();
    const claim = await this.database.transaction(async (tx) => {
      await this.lock(tx);
      if (this.leaseActive(await this.readLease(tx))) throw this.busy();
      // 跨实例短间隔去重 / 限流；失败也有冷却，避免手动刷新击穿第三方。
      const old = await this.catalog.leaderboardSnapshot(tx);
      if (old?.lastAttemptAt && this.clock.nowMs() - Date.parse(old.lastAttemptAt) < 60_000)
        return null;
      const lease: RefreshLease = {
        token: newId(),
        expiresAt: new Date(this.clock.nowMs() + REFRESH_LEASE_MS).toISOString(),
      };
      await tx.query(
        `INSERT INTO model_access.settings(key,value,updated_at) VALUES ($1,$2,$3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
        [REFRESH_LEASE_KEY, JSON.stringify(lease), this.clock.now()],
      );
      return { lease, old };
    });
    if (!claim) return this.status();
    try {
      let next: ArenaDataset | null;
      let error: string | null = null;
      try {
        next = await this.fetcher(source.url);
        if (!next.entries.length) throw new Error('官方数据集没有有效 Overall 榜单，保留上次结果');
        if (claim.old?.publishedAt && next.publishedAt < claim.old.publishedAt)
          throw new Error('官方响应日期早于当前有效榜单，保留上次结果');
      } catch (e) {
        next = null;
        error = (e instanceof Error ? e.message : '抓取失败').slice(0, 300);
        this.logger.warn(`榜单同步失败：${error}`);
      }
      await this.database.transaction(async (tx) => {
        await this.lock(tx);
        const lease = await this.readLease(tx);
        // 旧进程迟到时不得覆盖租约到期后的新刷新或手动导入。
        if (lease?.token !== claim.lease.token || !this.leaseActive(lease))
          throw new AppError('bad_request', '榜单刷新已过期，请重新刷新', { status: 409 });
        await this.save(
          tx,
          claim.old,
          next ? { ...next, method: 'fetch' } : null,
          error,
          adminId,
          'fetch',
        );
      });
    } finally {
      // 条件删除只释放自己，不能清除接管者的租约；数据库不可用时由租约到期兜底。
      await this.database
        .query("DELETE FROM model_access.settings WHERE key=$1 AND value->>'token'=$2", [
          REFRESH_LEASE_KEY,
          claim.lease.token,
        ])
        .catch(() => undefined);
    }
    return this.status();
  }

  private busy(): AppError {
    return new AppError('bad_request', '榜单正在刷新，请稍后再查看或导入', { status: 409 });
  }

  private async lock(tx: DbTx): Promise<void> {
    const { rows } = await tx.query<{ locked: boolean }>(
      'select pg_try_advisory_xact_lock($1) as locked',
      [LOCK_ID],
    );
    if (!rows[0]?.locked) throw this.busy();
  }

  private async readLease(tx: DbTx): Promise<RefreshLease | null> {
    const { rows } = await tx.query<{ value: RefreshLease }>(
      'SELECT value FROM model_access.settings WHERE key=$1',
      [REFRESH_LEASE_KEY],
    );
    return rows[0]?.value ?? null;
  }

  private leaseActive(lease: RefreshLease | null): boolean {
    return !!lease && Date.parse(lease.expiresAt) > this.clock.nowMs();
  }

  async importText(adminId: string, text: string): Promise<LeaderboardSnapshotStatus> {
    const entries = parseLeaderboard(text);
    if (!entries.length)
      throw new AppError('bad_request', '没有解析出榜单：需要每行有名次和模型名', { status: 422 });
    await this.database.transaction(async (tx) => {
      await this.lock(tx);
      if (this.leaseActive(await this.readLease(tx))) throw this.busy();
      const old = await this.catalog.leaderboardSnapshot(tx);
      const source = await this.catalog.leaderboardSource(tx);
      await this.save(
        tx,
        old,
        {
          method: 'paste',
          entries,
          sourceUrl: source.url,
          publishedAt: null,
          totalRows: entries.length,
        },
        null,
        adminId,
        'paste',
      );
    });
    return this.status();
  }

  private async save(
    tx: DbTx,
    old: LeaderboardSnapshot | null,
    next: {
      method: 'fetch' | 'paste';
      entries: LeaderboardEntry[];
      sourceUrl: string;
      publishedAt: string | null;
      totalRows: number;
    } | null,
    error: string | null,
    adminId: string | null,
    action: 'fetch' | 'paste',
  ): Promise<void> {
    const now = this.clock.now();
    const changed = next && JSON.stringify(next.entries) !== JSON.stringify(old?.entries);
    const value: LeaderboardSnapshot = next
      ? {
          fetchedAt: now.toISOString(),
          method: next.method,
          sourceUrl: next.sourceUrl,
          entries: next.entries,
          publishedAt: next.publishedAt,
          totalRows: next.totalRows,
          previousEntries:
            old?.method === next.method
              ? changed
                ? old.entries
                : (old.previousEntries ?? [])
              : [],
          lastAttemptAt: now.toISOString(),
          lastError: null,
        }
      : {
          fetchedAt: old?.fetchedAt ?? null,
          method: old?.method ?? null,
          sourceUrl: old?.sourceUrl ?? null,
          entries: old?.entries ?? [],
          publishedAt: old?.publishedAt ?? null,
          totalRows: old?.totalRows ?? null,
          previousEntries: old?.previousEntries ?? [],
          lastAttemptAt: now.toISOString(),
          lastError: error,
        };
    await tx.db
      .insert(modelAccessSettings)
      .values({ key: LEADERBOARD_SNAPSHOT_KEY, value, updatedAt: now, updatedBy: adminId })
      .onConflictDoUpdate({
        target: modelAccessSettings.key,
        set: { value, updatedAt: now, updatedBy: adminId },
      });
    await this.audit.record(
      {
        module: 'model_access',
        action: action === 'paste' ? 'leaderboard.imported' : 'leaderboard.refreshed',
        actorType: adminId ? 'admin' : 'system',
        ...(adminId ? { actorId: adminId } : {}),
        targetType: 'model_settings',
        targetId: null,
        details: { entries: next?.entries.length ?? 0, error },
      },
      tx,
    );
  }
}
