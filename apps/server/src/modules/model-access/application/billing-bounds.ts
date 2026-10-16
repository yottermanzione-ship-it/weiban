import { CATALOG_LOCK_KEY } from './catalog.js';
/** 路由计费证据只来自管理员核准配置；估算器不在此充当上限。 */
import { Inject, Injectable } from '@nestjs/common';
import { RouteBillingBounds, type UsageQuantities } from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  DATABASE,
  CLOCK,
  AUDIT_LOG,
  type Database,
  type Clock,
  type AuditLog,
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
    return parsed.success &&
      !parsed.data.pauseReason &&
      Date.parse(parsed.data.checkedAt) <= this.clock.nowMs()
      ? parsed.data
      : null;
  }
  async text(
    modelKey: string,
    candidates: RouteCandidate[],
    imageCount: number,
    requested: number,
  ) {
    const verified: VerifiedRoute[] = [];
    for (const candidate of candidates) {
      const b = await this.get(modelKey, candidate.upstreamId, candidate.upstreamModelId);
      if (b?.text && b.text.maxOutputTokens >= requested && b.text.maxImages >= imageCount)
        verified.push({ ...candidate, billingBounds: b });
    }
    if (!verified.length) return null;
    const usage: UsageQuantities = {
      inputTokens: Math.max(...verified.map((r) => r.billingBounds.text!.contextTokens)),
      outputTokens: Math.max(
        ...verified.map((r) =>
          Math.min(32000, Math.ceil(requested * 1.5), r.billingBounds.text!.maxOutputTokens),
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
  async pauseUnknown(
    modelKey: string,
    route: { upstreamId: string; upstreamModelId: string },
    bounds: RouteBillingBounds,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [CATALOG_LOCK_KEY]);
      const routes = await tx.db
        .select()
        .from(modelRoutes)
        .where(
          and(
            eq(modelRoutes.upstreamId, route.upstreamId),
            eq(modelRoutes.upstreamModelId, route.upstreamModelId),
          ),
        )
        .for('update');
      for (const row of routes) {
        if (
          !row.billingBounds ||
          Date.parse(row.billingBounds.checkedAt) > Date.parse(bounds.checkedAt)
        )
          continue;
        await tx.db
          .update(modelRoutes)
          .set({
            enabled: false,
            billingBounds: { ...row.billingBounds, pauseReason: 'usage_unknown' },
            updatedAt: this.clock.now(),
          })
          .where(
            and(
              eq(modelRoutes.modelKey, row.modelKey),
              eq(modelRoutes.upstreamId, route.upstreamId),
            ),
          );
      }
      const catalogs = await tx.db
        .select()
        .from(modelCatalog)
        .where(
          and(
            eq(modelCatalog.upstreamId, route.upstreamId),
            eq(modelCatalog.upstreamModelId, route.upstreamModelId),
          ),
        )
        .for('update');
      for (const row of catalogs) {
        if (
          !row.billingBounds ||
          Date.parse(row.billingBounds.checkedAt) > Date.parse(bounds.checkedAt)
        )
          continue;
        await tx.db
          .update(modelCatalog)
          .set({
            billingBounds: { ...row.billingBounds, pauseReason: 'usage_unknown' },
            updatedAt: this.clock.now(),
          })
          .where(eq(modelCatalog.modelKey, row.modelKey));
      }
      await this.audit.record(
        {
          module: 'model_access',
          action: 'billing_bounds.usage_unknown',
          actorType: 'system',
          targetType: 'model',
          targetId: modelKey,
          details: {
            upstreamId: route.upstreamId,
            upstreamModelId: route.upstreamModelId,
            evidence: boundsEvidence(bounds),
            reason: '供应商未报告有效用量，需核对后重新启用具体路由',
          },
        },
        tx,
      );
    });
  }

  /** 北京自然日+自然分钟窗口，用户别名/进程重启不刷新额度。仅首次逻辑请求调用，cache重放不消耗。 */
  async consumePurpose(userId: string, purpose: 'small_v' | 'search_candidates'): Promise<boolean> {
    const caps = purpose === 'small_v' ? { minute: 10, day: 100 } : { minute: 5, day: 30 };
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
