/**
 * v3.3（ADR-0032）：充值档位配置。档位、价格、赠送比例只来自服务器（后台配置，存 billing.settings 的
 * recharge_options）。第一版不开真实支付：paymentEnabled 恒为 false，用户端充值页显示「联系管理员充值」，
 * 管理员在后台按积分加余额（BillingAdminService.adjust，points 字段）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  MICROS_PER_POINT,
  POINTS_PER_YUAN,
  RechargeQuoteRequest,
  type RechargeOptions,
  type UpdateRechargeOptionsRequest,
} from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { billingSettings } from '../infra/db/schema.js';

const KEY = 'recharge_options';

interface StoredOptions {
  tiers: Array<{ tierId: string; priceMicros: number; bonusPercent: number }>;
  contactHint: string;
}

/** 没有配置时的默认档位（06-old-ui-spec 6.3：10 / 30 / 100 元，不赠送）。 */
const DEFAULT_OPTIONS: StoredOptions = {
  tiers: [
    { tierId: 't10', priceMicros: 10_000_000, bonusPercent: 0 },
    { tierId: 't30', priceMicros: 30_000_000, bonusPercent: 0 },
    { tierId: 't100', priceMicros: 100_000_000, bonusPercent: 0 },
  ],
  contactHint: '暂未开放在线充值，请联系管理员充值',
};

export function toRechargeOptions(stored: StoredOptions): RechargeOptions {
  return {
    paymentEnabled: false,
    pointsPerYuan: POINTS_PER_YUAN,
    contactHint: stored.contactHint,
    tiers: stored.tiers.map((t) => {
      const points = t.priceMicros / MICROS_PER_POINT;
      return {
        tierId: t.tierId,
        priceMicros: t.priceMicros,
        points,
        bonusPercent: t.bonusPercent,
        bonusPoints: Math.floor((points * t.bonusPercent) / 100),
      };
    }),
  };
}

@Injectable()
export class RechargeService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get(): Promise<RechargeOptions> {
    const [row] = await this.database.db
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.key, KEY));
    return toRechargeOptions((row?.value as StoredOptions | undefined) ?? DEFAULT_OPTIONS);
  }
  async quote(input: unknown) {
    const parsed = RechargeQuoteRequest.safeParse(input);
    if (!parsed.success) throw new AppError('bad_request', '充值金额须为5至10000元，最多两位小数');
    const priceMicros = parsed.data.amountFen * 10_000;
    const options = await this.get();
    return { priceMicros, points: priceMicros / MICROS_PER_POINT, paymentEnabled: false as const, contactHint: options.contactHint };
  }

  async update(
    operatorUserId: string,
    input: z.output<typeof UpdateRechargeOptionsRequest>,
  ): Promise<RechargeOptions> {
    const ids = input.tiers.map((t) => t.tierId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('bad_request', '充值档位编号不能重复');
    }
    const value: StoredOptions = { tiers: input.tiers, contactHint: input.contactHint };
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(billingSettings)
        .values({ key: KEY, value, updatedAt: now, updatedBy: operatorUserId })
        .onConflictDoUpdate({
          target: billingSettings.key,
          set: { value, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'billing',
          action: 'recharge_options.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'billing_settings',
          targetId: null,
          details: { tiers: input.tiers.length },
        },
        tx,
      );
    });
    return toRechargeOptions(value);
  }
}
