/**
 * v3.4（ADR-0032 第 4 条）：上游账号调度——借鉴 sub2api 的账号池设计（只学思路，代码自写）。
 *
 * 一次调用：
 * 1. plan()：取该模型启用的路由 → 账号启用 → 状态正常且不在暂停中的排前面（暂停到期但仍标「不可用」的账号
 *    排在最后当「试探」）→ 优先级数字小的组先用 → 组内按权重排序。
 *    排序用「加权一致性散列」（rendezvous hashing）：分数 = −ln(u) / 权重，u 由「会话 + 模型 + 账号」散列得出。
 *    同一会话稳定落在同一账号（粘性会话，利于上游缓存命中）；该账号不可用时自然落到下一个；
 *    没有会话时 u 取随机数，等价于按权重比例分流。
 * 2. acquire()：按顺序试每个账号的并发 / 每分钟上限，拿到槽位就用它；网关失败可切到下一个。
 * 3. recordSuccess / recordFailure：成功清零连续失败；可切换的失败累加，达到阈值 → 暂停（cooldown）并标「不可用」；
 *    密钥失效 / 额度耗尽直接标对应状态。恢复靠 GatewayMaintenance 的探测（连通即恢复）。
 *
 * 每用户、每账号的并发与每分钟计数放在进程内存（单实例部署；多实例需改为共享存储，ADR-0032「代价」）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { UpstreamStatus } from '@weiban/contracts';
import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { CLOCK, DATABASE, type Clock, type Database } from '../../../platform/index.js';
import { modelRoutes, upstreams } from '../infra/db/schema.js';
import { GatewayLimitsService } from './limits.js';
import { UpstreamService } from './upstreams.js';

export interface RouteCandidate {
  upstreamId: string;
  upstreamModelId: string;
  baseUrl: string;
  maxConcurrency: number | null;
  rpmLimit: number | null;
  /** 暂停到期但状态仍为「不可用」的账号（排在最后试探）。 */
  probing: boolean;
}

/** 可以换账号重试的失败类别（同一次调用内切换，不等待）。内容被拒、请求错误不切换。 */
export const FAILOVER_CATEGORIES: readonly string[] = [
  'network_error',
  'provider_error',
  'rate_limited',
  'quota_exhausted',
  'invalid_key',
  'timeout',
];

const WINDOW_MS = 60_000;

/** 0～1 之间的确定性数（散列）。 */
function unit(key: string): number {
  const h = createHash('sha256').update(key).digest();
  return (h.readUInt32BE(0) + 1) / 4_294_967_297;
}

@Injectable()
export class UpstreamScheduler {
  private readonly accountInFlight = new Map<string, number>();
  private readonly userInFlight = new Map<string, number>();
  private readonly accountHits = new Map<string, number[]>();
  private readonly userHits = new Map<string, number[]>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GatewayLimitsService) private readonly limits: GatewayLimitsService,
    @Inject(UpstreamService) private readonly upstreams: UpstreamService,
  ) {}

  /** 该模型可用的账号，按调度顺序排好。stickyKey = 会话 ID（没有时用 null，按权重随机）。 */
  async plan(modelKey: string, stickyKey: string | null): Promise<RouteCandidate[]> {
    const rows = await this.database.db
      .select({ route: modelRoutes, upstream: upstreams })
      .from(modelRoutes)
      .innerJoin(upstreams, eq(upstreams.id, modelRoutes.upstreamId))
      .where(
        and(
          eq(modelRoutes.modelKey, modelKey),
          eq(modelRoutes.enabled, true),
          eq(upstreams.enabled, true),
        ),
      )
      .orderBy(asc(modelRoutes.priority), asc(upstreams.priority));
    const now = this.clock.nowMs();
    const scored = rows
      .map(({ route, upstream }) => {
        const cooling = upstream.cooldownUntil !== null && upstream.cooldownUntil.getTime() > now;
        const healthy = upstream.status === 'active' && !cooling;
        const probing = upstream.status === 'unavailable' && !cooling;
        if (!healthy && !probing) return null;
        const weight = Math.max(1, route.weight) * Math.max(1, upstream.weight);
        const u = stickyKey
          ? unit(`${stickyKey}|${modelKey}|${upstream.id}`)
          : Math.random() || 1e-9;
        return {
          candidate: {
            upstreamId: upstream.id,
            upstreamModelId: route.upstreamModelId,
            baseUrl: upstream.baseUrl,
            maxConcurrency: upstream.maxConcurrency,
            rpmLimit: upstream.rpmLimit,
            probing,
          },
          // 路由优先级在前，账号优先级其次
          tier: [probing ? 1 : 0, route.priority, upstream.priority] as const,
          score: -Math.log(u) / weight,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    scored.sort(
      (a, b) =>
        a.tier[0] - b.tier[0] ||
        a.tier[1] - b.tier[1] ||
        a.tier[2] - b.tier[2] ||
        a.score - b.score,
    );
    return scored.map((s) => s.candidate);
  }

  // ---------- 每用户限流 ----------

  /** 占用一个用户槽位；超出每用户并发或每分钟上限时返回 false（不占用）。 */
  async acquireUser(userId: string): Promise<boolean> {
    const limits = await this.limits.get();
    const inFlight = this.userInFlight.get(userId) ?? 0;
    if (limits.perUserConcurrency !== null && inFlight >= limits.perUserConcurrency) return false;
    if (!this.hit(this.userHits, userId, limits.perUserRpm)) return false;
    this.userInFlight.set(userId, inFlight + 1);
    return true;
  }

  releaseUser(userId: string): void {
    const n = (this.userInFlight.get(userId) ?? 1) - 1;
    if (n <= 0) this.userInFlight.delete(userId);
    else this.userInFlight.set(userId, n);
  }

  // ---------- 每账号限流 ----------

  /** 占用账号槽位；超出账号并发或每分钟上限时返回 false。 */
  acquireAccount(c: RouteCandidate): boolean {
    const inFlight = this.accountInFlight.get(c.upstreamId) ?? 0;
    if (c.maxConcurrency !== null && inFlight >= c.maxConcurrency) return false;
    if (!this.hit(this.accountHits, c.upstreamId, c.rpmLimit)) return false;
    this.accountInFlight.set(c.upstreamId, inFlight + 1);
    return true;
  }

  releaseAccount(upstreamId: string): void {
    const n = (this.accountInFlight.get(upstreamId) ?? 1) - 1;
    if (n <= 0) this.accountInFlight.delete(upstreamId);
    else this.accountInFlight.set(upstreamId, n);
  }

  inFlight(upstreamId: string): number {
    return this.accountInFlight.get(upstreamId) ?? 0;
  }

  // ---------- 健康 ----------

  async recordSuccess(upstreamId: string): Promise<void> {
    const now = this.clock.now();
    const [row] = await this.database.db
      .update(upstreams)
      .set({ consecutiveFailures: 0, cooldownUntil: null, lastUsedAt: now })
      .where(eq(upstreams.id, upstreamId))
      .returning({ status: upstreams.status });
    if (row && row.status !== 'active')
      await this.upstreams.reportStatus(upstreamId, 'active', 'gateway');
  }

  /**
   * 记一次失败。密钥失效 / 额度耗尽立即标对应状态并暂停；其他可切换的失败累加，达到阈值暂停并标「不可用」。
   * 内容被拒、请求错误、空输出等不算账号故障，调用方不要传进来。
   */
  async recordFailure(upstreamId: string, category: string): Promise<void> {
    const limits = await this.limits.get();
    const now = this.clock.nowMs();
    const until = new Date(now + limits.cooldownSeconds * 1000);
    const [row] = await this.database.db
      .update(upstreams)
      .set({
        consecutiveFailures: sql`${upstreams.consecutiveFailures} + 1`,
        lastError: category.slice(0, 64),
        lastUsedAt: new Date(now),
      })
      .where(eq(upstreams.id, upstreamId))
      .returning({ failures: upstreams.consecutiveFailures });
    if (!row) return;
    let next: UpstreamStatus | null = null;
    if (category === 'invalid_key') next = 'invalid';
    else if (category === 'quota_exhausted') next = 'quota_exhausted';
    else if (row.failures >= limits.failureThreshold) next = 'unavailable';
    if (!next) return;
    await this.database.db
      .update(upstreams)
      .set({ cooldownUntil: until })
      .where(eq(upstreams.id, upstreamId));
    await this.upstreams.reportStatus(
      upstreamId,
      next,
      'gateway',
      category === 'rate_limited' ? 'provider_error' : category,
    );
  }

  /** 滑动 1 分钟窗口计数；limit 为 null 不限。返回 false 表示已满（不记这次）。 */
  private hit(map: Map<string, number[]>, key: string, limit: number | null): boolean {
    if (limit === null) return true;
    const now = this.clock.nowMs();
    const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= limit) {
      map.set(key, list);
      return false;
    }
    list.push(now);
    map.set(key, list);
    return true;
  }
}
