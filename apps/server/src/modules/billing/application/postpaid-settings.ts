/**
 * 3.27（H1，总经理 10-21「先用后扣、可欠一次」）：先用后扣的保护参数，后台可调。
 * 存在 billing.settings 的 postpaid_limits 键；没改过时用契约 POSTPAID_DEFAULTS。
 * - maxConcurrentPaidCalls：同一用户同时进行的付费模型调用上限（防止多个调用同时开始、一起把余额扣成大额负数）；
 * - concurrencyWaitSeconds：满了时前台调用最多排队等几秒；后台任务不等；
 * - largeRequestLimitPoints：单次预估超过这么多积分的异常巨额请求先拦截。
 * 读取有 5 秒进程内缓存（冻结是热路径）；修改后本进程立即生效，其它进程最多 5 秒。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  MICROS_PER_POINT,
  POSTPAID_DEFAULTS,
  PostpaidSettings,
  type UpdatePostpaidSettingsRequest,
} from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { billingSettings } from '../infra/db/schema.js';

const KEY = 'postpaid_limits';
const CACHE_MS = 5_000;

export interface PostpaidLimits {
  maxConcurrentPaidCalls: number;
  concurrencyWaitMs: number;
  largeRequestLimitMicros: number;
}

export function toLimits(s: Omit<PostpaidSettings, 'updatedAt'>): PostpaidLimits {
  return {
    maxConcurrentPaidCalls: s.maxConcurrentPaidCalls,
    concurrencyWaitMs: s.concurrencyWaitSeconds * 1000,
    largeRequestLimitMicros: s.largeRequestLimitPoints * MICROS_PER_POINT,
  };
}

@Injectable()
export class PostpaidSettingsService {
  private cache: { at: number; value: PostpaidSettings } | null = null;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(): Promise<PostpaidSettings> {
    const now = this.clock.nowMs();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    const [row] = await this.database.db
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.key, KEY));
    const parsed = PostpaidSettings.omit({ updatedAt: true })
      .partial()
      .safeParse(row?.value ?? {});
    const value: PostpaidSettings = {
      ...POSTPAID_DEFAULTS,
      ...(parsed.success ? parsed.data : {}),
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
    this.cache = { at: now, value };
    return value;
  }

  async limits(): Promise<PostpaidLimits> {
    return toLimits(await this.get());
  }

  async update(
    operatorUserId: string,
    input: z.output<typeof UpdatePostpaidSettingsRequest>,
  ): Promise<PostpaidSettings> {
    const current = await this.get();
    const next = {
      maxConcurrentPaidCalls: input.maxConcurrentPaidCalls ?? current.maxConcurrentPaidCalls,
      concurrencyWaitSeconds: input.concurrencyWaitSeconds ?? current.concurrencyWaitSeconds,
      largeRequestLimitPoints: input.largeRequestLimitPoints ?? current.largeRequestLimitPoints,
    };
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(billingSettings)
        .values({ key: KEY, value: next, updatedAt: now, updatedBy: operatorUserId })
        .onConflictDoUpdate({
          target: billingSettings.key,
          set: { value: next, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'billing',
          action: 'postpaid_settings.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'billing_settings',
          targetId: null,
          details: { before: { ...current, updatedAt: undefined }, after: next },
        },
        tx,
      );
    });
    const value: PostpaidSettings = { ...next, updatedAt: now.toISOString() };
    this.cache = { at: this.clock.nowMs(), value };
    return value;
  }
}
