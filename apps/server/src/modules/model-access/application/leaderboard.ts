/**
 * 3.24（试用反馈第二轮 F2 第 6 条）：模型排行榜自动获取。
 *
 * - 服务器每天 04:20（北京时间）抓一次后台填的榜单来源链接（ModelLeaderboardSource.url，只允许 arena.ai / lmarena.ai 的 https），
 *   后台也可「立即刷新」。抓到后按模型的「榜单对应名称」匹配名次，用户端按相对顺序重新编号 1..N（catalog.listModels）。
 * - 抓取失败（网络、网站开启人机验证、页面里解析不出榜单）**保留上次结果**，只记下失败时间与原因，后台工作台可见。
 * - 兜底：后台粘贴从网页复制的榜单表格文本或 CSV 导入（同一个解析器）。
 *
 * 2026-10-21 实测：arena.ai 对服务器请求返回 Cloudflare 人机验证页（403 「Just a moment...」），不提供公开数据接口；
 * 平台不绕过人机验证。所以抓取多半会失败并提示改用粘贴导入；网站以后放开时自动抓取即可生效。
 *
 * 快照存 model_access.settings（LEADERBOARD_SNAPSHOT_KEY），不另建表。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { LeaderboardSnapshotStatus } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  type AuditLog,
  type Clock,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import {
  looksLikeBotChallenge,
  normalizeArenaName,
  parseLeaderboard,
  relativeRanks,
  type LeaderboardEntry,
} from '../domain/leaderboard.js';
import { modelAccessSettings, modelCatalog } from '../infra/db/schema.js';
import { CatalogService, LEADERBOARD_SNAPSHOT_KEY, type LeaderboardSnapshot } from './catalog.js';

export const REFRESH_LEADERBOARD_JOB = 'model_access.refresh_leaderboard';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_PAGE_BYTES = 5_000_000;
const ALLOWED_HOST = /^(www\.)?(arena|lmarena)\.ai$/;

/** 抓取页面（只允许 arena / lmarena 的 https；最多跟 3 次同站重定向；最多读 5MB）。失败抛出带中文原因的错误。 */
export type LeaderboardFetcher = (url: string) => Promise<string>;

export const defaultLeaderboardFetcher: LeaderboardFetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !ALLOWED_HOST.test(parsed.hostname))
      throw new Error('榜单链接只能是 arena.ai / lmarena.ai 的 https 地址');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; WeibanLeaderboard/1.0)',
        },
      });
    } catch {
      throw new Error('连接榜单网站失败（网络错误或超时）');
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!next) throw new Error(`榜单网站返回了没有地址的跳转（${response.status}）`);
      url = new URL(next, url).toString();
      continue;
    }
    const body = await readText(response);
    if (looksLikeBotChallenge(response.status, body))
      throw new Error('榜单网站开启了人机验证，服务器无法自动抓取，请用「粘贴导入」');
    if (!response.ok) throw new Error(`榜单网站返回错误（HTTP ${response.status}）`);
    return body;
  }
  throw new Error('榜单网站跳转次数过多');
};

async function readText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error('榜单页面过大');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

export const LEADERBOARD_FETCHER = Symbol('weiban.model-access.leaderboard-fetcher');

@Injectable()
export class LeaderboardService implements OnModuleInit {
  private readonly logger = new Logger('Leaderboard');
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(LEADERBOARD_FETCHER) private readonly fetcher: LeaderboardFetcher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work(REFRESH_LEADERBOARD_JOB, async () => {
      if (!(await this.catalog.leaderboardSource())) return;
      await this.refresh(null);
    });
    await this.jobs.schedule(REFRESH_LEADERBOARD_JOB, '20 4 * * *', { tz: 'Asia/Shanghai' });
  }

  /** 后台：当前状态（快照、失败原因、匹配 / 未匹配）。 */
  async status(): Promise<LeaderboardSnapshotStatus> {
    const source = await this.catalog.leaderboardSource();
    const snapshot = await this.catalog.leaderboardSnapshot();
    const byName = new Map(
      (snapshot?.entries ?? []).map((e) => [normalizeArenaName(e.name), e.rank] as const),
    );
    const rows = (
      await this.database.db
        .select({
          modelKey: modelCatalog.modelKey,
          displayName: modelCatalog.displayName,
          arenaModelName: modelCatalog.arenaModelName,
          leaderboardRank: modelCatalog.leaderboardRank,
          sortOrder: modelCatalog.sortOrder,
        })
        .from(modelCatalog)
        .where(eq(modelCatalog.enabled, true))
    ).sort((a, b) => a.sortOrder - b.sortOrder || a.modelKey.localeCompare(b.modelKey));
    const matchedRank = (name: string | null) =>
      name ? (byName.get(normalizeArenaName(name)) ?? null) : null;
    // 相对名次与用户端同一口径（自动名次优先，否则手填名次；用户端还会按场景筛选后重新编号）
    const relative = relativeRanks(
      rows.map((r) => ({
        key: r.modelKey,
        rank: matchedRank(r.arenaModelName) ?? r.leaderboardRank,
      })),
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
          relativeRank: relative.get(r.modelKey) ?? 1,
        });
      else
        unmatched.push({
          modelKey: r.modelKey,
          displayName: r.displayName,
          arenaModelName: r.arenaModelName ?? null,
        });
    }
    matched.sort((a, b) => a.rank - b.rank);
    return {
      source,
      snapshot:
        snapshot?.fetchedAt && snapshot.method
          ? {
              fetchedAt: snapshot.fetchedAt,
              method: snapshot.method,
              entries: snapshot.entries.length,
            }
          : null,
      lastAttemptAt: snapshot?.lastAttemptAt ?? null,
      lastError: snapshot?.lastError ?? null,
      matched,
      unmatched,
    };
  }

  /** 抓取来源链接（定时任务 adminId = null；后台「立即刷新」传管理员）。失败保留上次结果。 */
  async refresh(adminId: string | null): Promise<LeaderboardSnapshotStatus> {
    const source = await this.catalog.leaderboardSource();
    if (!source)
      throw new AppError('bad_request', '请先在模型管理页顶部填写榜单来源链接', { status: 422 });
    let entries: LeaderboardEntry[] = [];
    let error: string | null = null;
    try {
      const page = await this.fetcher(source.url);
      entries = parseLeaderboard(page);
      if (!entries.length)
        error = '抓到了页面，但没有找到榜单数据（网站可能改版或需要浏览器渲染），请用「粘贴导入」';
    } catch (e) {
      error = (e instanceof Error ? e.message : '抓取失败').slice(0, 300);
    }
    if (error) this.logger.warn(`榜单抓取失败：${error}`);
    await this.save(
      entries.length ? { method: 'fetch', entries, sourceUrl: source.url } : null,
      error,
      adminId,
      'fetch',
    );
    return this.status();
  }

  /** 后台粘贴导入（文本或 CSV）。一条都解析不出时 422，不改原快照。 */
  async importText(adminId: string, text: string): Promise<LeaderboardSnapshotStatus> {
    const entries = parseLeaderboard(text);
    if (!entries.length)
      throw new AppError(
        'bad_request',
        '没有从内容里解析出榜单：需要每行有「名次」和「模型名」（从榜单网页整表复制，或 CSV 带 rank / model 表头）',
        { status: 422 },
      );
    const source = await this.catalog.leaderboardSource();
    await this.save(
      { method: 'paste', entries, sourceUrl: source?.url ?? null },
      null,
      adminId,
      'paste',
    );
    return this.status();
  }

  private async save(
    next: {
      method: 'fetch' | 'paste';
      entries: LeaderboardEntry[];
      sourceUrl: string | null;
    } | null,
    error: string | null,
    adminId: string | null,
    action: 'fetch' | 'paste',
  ): Promise<void> {
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      const old = await this.catalog.leaderboardSnapshot();
      const value: LeaderboardSnapshot = next
        ? {
            fetchedAt: now.toISOString(),
            method: next.method,
            sourceUrl: next.sourceUrl,
            entries: next.entries.map((e) => ({ name: e.name, rank: e.rank })),
            lastAttemptAt: now.toISOString(),
            lastError: null,
          }
        : {
            fetchedAt: old?.fetchedAt ?? null,
            method: old?.method ?? null,
            sourceUrl: old?.sourceUrl ?? null,
            entries: old?.entries ?? [],
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
    });
  }
}
