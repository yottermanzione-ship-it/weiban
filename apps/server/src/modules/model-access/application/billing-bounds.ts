/** 路由计费证据只来自管理员核准配置；估算器不在此充当上限。 */
import { Inject, Injectable } from '@nestjs/common';
import {
  RouteBillingBounds,
  USAGE_MISSING_ALERT_STREAK,
  type UsageQuantities,
} from '@weiban/contracts';
import { and, eq, gt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  DATABASE,
  CLOCK,
  AUDIT_LOG,
  OUTBOX,
  type Database,
  type Clock,
  type AuditLog,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { modelRoutes, modelCatalog, platformPurposeLimits } from '../infra/db/schema.js';
import { localDate } from '../../../platform/time/local-time.js';
import type { RouteCandidate } from './scheduler.js';
export type VerifiedRoute = RouteCandidate & { billingBounds: RouteBillingBounds };
export function boundsEvidence(bounds: unknown) {
  return createHash('sha256').update(JSON.stringify(bounds)).digest('hex');
}
@Injectable()
export class BillingBoundsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}
  async get(
    modelKey: string,
    upstreamId: string,
    upstreamModelId: string,
  ): Promise<RouteBillingBounds | null> {
    const [route] = await this.db.db
      .select()
      .from(modelRoutes)
      .where(and(eq(modelRoutes.modelKey, modelKey), eq(modelRoutes.upstreamId, upstreamId)));
    const [catalog] = await this.db.db
      .select()
      .from(modelCatalog)
      .where(eq(modelCatalog.modelKey, modelKey));
    if (!catalog?.enabled || (route && !route.enabled)) return null;
    let raw: unknown = route?.upstreamModelId === upstreamModelId ? route.billingBounds : null;
    if (!route) {
      if (catalog.upstreamId === upstreamId && catalog.upstreamModelId === upstreamModelId)
        raw = catalog.billingBounds;
    }
    const parsed = RouteBillingBounds.safeParse(raw);
    // 3.24：核对时间可选（后台不再填，保存时由服务器记下）；带了的不能在未来
    return parsed.success &&
      !parsed.data.pauseReason &&
      (parsed.data.checkedAt === undefined ||
        Date.parse(parsed.data.checkedAt) <= this.clock.nowMs())
      ? parsed.data
      : null;
  }
  async text(
    modelKey: string,
    candidates: RouteCandidate[],
    imageCount: number,
    /** null = 聊天未指定业务小额度，使用各线路核准的完整输出上限（含思考）。 */
    requested: number | null,
    /** 批 EJ：后台任务另给的思考预算；线路核验只看正文额度，计费上限另外加上思考。 */
    thinkingBudget = 0,
  ) {
    const verified: VerifiedRoute[] = [];
    for (const candidate of candidates) {
      const b = await this.get(modelKey, candidate.upstreamId, candidate.upstreamModelId);
      if (b?.text && b.text.maxOutputTokens >= (requested ?? 1) && b.text.maxImages >= imageCount)
        verified.push({ ...candidate, billingBounds: b });
    }
    if (!verified.length) return null;
    const usage: UsageQuantities = {
      inputTokens: Math.max(...verified.map((r) => r.billingBounds.text!.contextTokens)),
      outputTokens: Math.max(
        ...verified.map((r) =>
          Math.min(
            32000,
            requested === null
              ? r.billingBounds.text!.maxOutputTokens
              : Math.ceil(requested * 1.5) + Math.max(0, thinkingBudget),
            r.billingBounds.text!.maxOutputTokens,
          ),
        ),
      ),
    };
    return {
      routes: verified,
      ceiling: {
        usage,
        evidence: boundsEvidence(
          verified.map((r) => ({
            upstreamId: r.upstreamId,
            upstreamModelId: r.upstreamModelId,
            bounds: r.billingBounds,
          })),
        ),
      },
    };
  }
  /** 报价/可用性用已启用且核准的全部可能路由，不以用户消息长度经验估费。 */
  async profiles(modelKey: string): Promise<RouteBillingBounds[]> {
    const routes = await this.db.db
      .select()
      .from(modelRoutes)
      .where(eq(modelRoutes.modelKey, modelKey));
    const tuples = routes.length
      ? routes
      : await this.db.db.select().from(modelCatalog).where(eq(modelCatalog.modelKey, modelKey));
    const profiles: RouteBillingBounds[] = [];
    for (const tuple of tuples) {
      const proof = await this.get(modelKey, tuple.upstreamId, tuple.upstreamModelId);
      if (proof) profiles.push(proof);
    }
    return profiles;
  }
  /**
   * 3.26（G3-2）：记录一次上游调用有没有返回用量（取代原「用量未知 → 暂停线路」）。
   * - reported：上游报了用量，这条线路的连续缺用量计数清零；
   * - missing：上游没报（已按本地估算计费，或进程中断后成本待核），计数 +1。连续达到
   *   USAGE_MISSING_ALERT_STREAK 次时写审计、发一条管理员提醒（info，只进后台列表），本轮不再重复提醒；
   *   **不停用线路**（总经理 10-21 确认）。
   * 同一上游模型名可能挂在多个模型下（按上游 + 上游模型名一起更新）。
   */
  async recordUsage(
    modelKey: string,
    route: { upstreamId: string; upstreamModelId: string },
    state: 'reported' | 'missing',
    transaction?: DbTx,
  ): Promise<void> {
    const where = and(
      eq(modelRoutes.upstreamId, route.upstreamId),
      eq(modelRoutes.upstreamModelId, route.upstreamModelId),
    );
    if (state === 'reported') {
      const db = transaction?.db ?? this.db.db;
      await db
        .update(modelRoutes)
        .set({ usageMissingStreak: 0, usageMissingSince: null, usageMissingAlertedAt: null })
        .where(and(where, gt(modelRoutes.usageMissingStreak, 0)));
      return;
    }
    const run = async (tx: DbTx) => {
      const now = this.clock.now();
      const rows = await tx.db
        .update(modelRoutes)
        .set({
          usageMissingStreak: sql`${modelRoutes.usageMissingStreak} + 1`,
          usageMissingSince: sql`coalesce(${modelRoutes.usageMissingSince}, ${now})`,
        })
        .where(where)
        .returning({
          modelKey: modelRoutes.modelKey,
          streak: modelRoutes.usageMissingStreak,
          alertedAt: modelRoutes.usageMissingAlertedAt,
        });
      const due = rows.filter((r) => r.streak >= USAGE_MISSING_ALERT_STREAK && !r.alertedAt);
      if (!due.length) return;
      await tx.db.update(modelRoutes).set({ usageMissingAlertedAt: now }).where(where);
      const streak = Math.max(...due.map((r) => r.streak));
      const name =
        route.upstreamModelId.length > 60
          ? `${route.upstreamModelId.slice(0, 57)}...`
          : route.upstreamModelId;
      await this.outbox.publish(tx, 'platform.admin_alert_raised', 'model_access', {
        kind: 'upstream_usage_missing',
        severity: 'info',
        dedupeKey: `upstream_usage_missing:${route.upstreamId}:${createHash('sha256')
          .update(route.upstreamModelId)
          .digest('hex')
          .slice(0, 16)}`,
        summary: `线路「${name}」连续 ${streak} 次没有返回用量，已按本地估算计费（线路照常使用）。可检查上游是否返回 usage。`,
        refs: { upstreamId: route.upstreamId },
      });
      await this.audit.record(
        {
          module: 'model_access',
          action: 'billing_bounds.usage_missing_streak',
          actorType: 'system',
          targetType: 'model',
          targetId: modelKey,
          details: {
            upstreamId: route.upstreamId,
            upstreamModelId: route.upstreamModelId,
            streak,
            models: due.map((r) => r.modelKey),
          },
        },
        tx,
      );
    };
    if (transaction) await run(transaction);
    else await this.db.transaction(run);
  }

  /** 北京自然日+自然分钟窗口，用户别名/进程重启不刷新额度。仅首次逻辑请求调用，cache重放不消耗。 */
  async consumePurpose(userId: string, purpose: 'small_v' | 'search_candidates'): Promise<boolean> {
    const caps = purpose === 'small_v' ? { minute: 10, day: 100 } : { minute: 5, day: 20 };
    return this.db.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('model:platform:' || $1 || ':' || $2,0))",
        [userId, purpose],
      );
      const now = this.clock.now(),
        day = localDate(now, 'Asia/Shanghai'),
        minute = new Date(Math.floor(now.getTime() / 60000) * 60000);
      const [old] = await tx.db
        .select()
        .from(platformPurposeLimits)
        .where(
          and(eq(platformPurposeLimits.userId, userId), eq(platformPurposeLimits.purpose, purpose)),
        );
      const count = old?.day === day ? old.count : 0,
        minuteCount = old?.minuteStarts.getTime() === minute.getTime() ? old.minuteCount : 0;
      if (count >= caps.day || minuteCount >= caps.minute) return false;
      const value = {
        userId,
        purpose,
        day,
        count: count + 1,
        minuteStarts: minute,
        minuteCount: minuteCount + 1,
      };
      await tx.db
        .insert(platformPurposeLimits)
        .values(value)
        .onConflictDoUpdate({
          target: [platformPurposeLimits.userId, platformPurposeLimits.purpose],
          set: value,
        });
      return true;
    });
  }
}

/**
 * 3.27（H1 先用后扣）：计费拒绝原因 → 网关对外错误。
 * price_missing → model_unavailable；并发已满 → provider_unavailable（暂时，稍后可重试）；
 * 异常巨额 → budget_exceeded（与后台上限同类：不调用、不扣费）。
 */
export function reserveErrorToGenerate(
  error: import('@weiban/contracts').ReserveError,
): 'model_unavailable' | 'provider_unavailable' | 'insufficient_balance' | 'budget_exceeded' {
  switch (error) {
    case 'price_missing':
      return 'model_unavailable';
    case 'concurrency_limited':
      return 'provider_unavailable';
    case 'request_too_large':
      return 'budget_exceeded';
    default:
      return error;
  }
}
