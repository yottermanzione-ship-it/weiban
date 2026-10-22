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
          arenaModelName: modelCatalog.arenaModelName,
          sortOrder: modelCatalog.sortOrder,
        })
        .from(modelCatalog)
        .where(and(eq(modelCatalog.enabled, true), isNull(modelCatalog.deletedAt)))
    ).sort((a, b) => a.sortOrder - b.sortOrder || a.modelKey.localeCompare(b.modelKey));
    const matchedRank = (name: string | null) =>
      name ? (byName.get(normalizeArenaName(name)) ?? null) : null;
    const relative = relativeRanks(
      rows.map((r) => ({ key: r.modelKey, rank: matchedRank(r.arenaModelName) })),
    );
    const matched: LeaderboardSnapshotStatus['matched'] = [];
    const unmatched: LeaderboardSnapshotStatus['unmatched'] = [];
    for (const r of rows) {
      const rank = matchedRank(r.arenaModelName);
      if (rank !== null && r.arenaModelName)
        matched.push({
          modelKey: r.modelKey,
          displayName: r.displayName,
          arenaModelName: r.arenaModelName,
          rank,
          relativeRank: relative.get(r.modelKey)!,
        });
      else
        unmatched.push({
          modelKey: r.modelKey,
          displayName: r.displayName,
          arenaModelName: r.arenaModelName ?? null,
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

  /** 同进程合并刷新；数据库咨询锁保证多个实例也不会同时抓取或被导入覆盖。 */
  refresh(adminId: string | null): Promise<LeaderboardSnapshotStatus> {
    if (this.pending) return this.pending;
    this.pending = this.refreshOnce(adminId).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async refreshOnce(adminId: string | null): Promise<LeaderboardSnapshotStatus> {
    const source = await this.catalog.leaderboardSource();
    await this.database.transaction(async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>(
        'select pg_try_advisory_xact_lock($1) as locked',
        [LOCK_ID],
      );
      if (!rows[0]?.locked)
        throw new AppError('bad_request', '榜单正在刷新，请稍后再查看', { status: 409 });
      // 跨实例短间隔去重 / 限流；失败也有冷却，避免手动刷新击穿第三方。
      const old = await this.catalog.leaderboardSnapshot();
      if (old?.lastAttemptAt && this.clock.nowMs() - Date.parse(old.lastAttemptAt) < 60_000) return;
      let next: ArenaDataset | null;
      let error: string | null = null;
      try {
        next = await this.fetcher(source.url);
        if (!next.entries.length) throw new Error('官方数据集没有有效 Overall 榜单，保留上次结果');
        if (old?.publishedAt && next.publishedAt < old.publishedAt)
          throw new Error('官方响应日期早于当前有效榜单，保留上次结果');
      } catch (e) {
        next = null;
        error = (e instanceof Error ? e.message : '抓取失败').slice(0, 300);
        this.logger.warn(`榜单同步失败：${error}`);
      }
      await this.save(tx, old, next ? { ...next, method: 'fetch' } : null, error, adminId, 'fetch');
    });
    return this.status();
  }

  async importText(adminId: string, text: string): Promise<LeaderboardSnapshotStatus> {
    const entries = parseLeaderboard(text);
    if (!entries.length)
      throw new AppError('bad_request', '没有解析出榜单：需要每行有名次和模型名', { status: 422 });
    await this.database.transaction(async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>(
        'select pg_try_advisory_xact_lock($1) as locked',
        [LOCK_ID],
      );
      if (!rows[0]?.locked)
        throw new AppError('bad_request', '榜单正在刷新，请稍后再导入', { status: 409 });
      const old = await this.catalog.leaderboardSnapshot();
      const source = await this.catalog.leaderboardSource();
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
