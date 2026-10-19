/**
 * 3.17（会员 v5，docs/refactor/16-membership-v5.md §3、§7）：PRO+ 开通订单、会员配置、注册赠送。
 *
 * - 现阶段没有真实支付：管理员在后台替用户开通某档，本服务在**同一事务**里：锁用户钱包 → 查幂等 → 判断首次价 →
 *   经 identity 写端口叠加到期时间 → 记订单 → 发一次性赠送积分（admin_grant，bonusCredit，计入赠送余额）。
 * - 首次价每人限一次（任一档）：部分唯一索引 membership_orders_first_purchase_key 兜底并发。
 * - 配置存 billing.settings：membership_settings（三档价格 / 赠送、联系说明、注册赠送积分）。
 * - 注册赠送：identity.user_registered 时按当时配置发一次（幂等键 signup_bonus:{userId}），默认 0 不发。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  MembershipSettings,
  pointsToMicros,
  type CreateMembershipOrder,
  type IdentityMembershipReadPort,
  type IdentityMembershipWritePort,
  type MembershipOffer,
  type MembershipOrder,
  type MembershipPlanId,
} from '@weiban/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import {
  IDENTITY_MEMBERSHIP_READ_PORT,
  IDENTITY_MEMBERSHIP_WRITE_PORT,
} from '../../identity/index.js';
import { billingSettings, membershipOrders } from '../infra/db/schema.js';
import { Ledger } from './ledger.js';

const KEY = 'membership_settings';
export const SIGNUP_BONUS_KEY_PREFIX = 'signup_bonus:';

/** 16 号 §3 已定价格与赠送；注册赠送默认 0（数额待总经理定）。 */
export const DEFAULT_MEMBERSHIP_SETTINGS: MembershipSettings = {
  plans: [
    { planId: 'month', name: '月卡', months: 1, priceFen: 2000, firstPriceFen: 1290, bonusPoints: 3000 },
    { planId: 'quarter', name: '季卡', months: 3, priceFen: 5800, firstPriceFen: 3990, bonusPoints: 9000 },
    { planId: 'year', name: '年卡', months: 12, priceFen: 19800, firstPriceFen: 15990, bonusPoints: 30000 },
  ],
  contactHint: '暂未开放在线支付，请联系管理员开通',
  signupBonusPoints: 0,
};

const PLAN_ORDER: MembershipPlanId[] = ['month', 'quarter', 'year'];

type OrderRow = typeof membershipOrders.$inferSelect;

function toOrder(r: OrderRow): MembershipOrder {
  return {
    orderId: r.id,
    userId: r.userId,
    planId: r.planId as MembershipPlanId,
    priceFen: r.priceFen,
    listPriceFen: r.listPriceFen,
    firstPurchase: r.firstPurchase,
    bonusPoints: r.bonusPoints,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    operatorUserId: r.operatorUserId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

@Injectable()
export class MembershipOrderService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(IDENTITY_MEMBERSHIP_WRITE_PORT) private readonly membershipWrite: IdentityMembershipWritePort,
  ) {}

  // ---------- 配置 ----------

  async getSettings(tx?: DbTx): Promise<MembershipSettings> {
    const [row] = await (tx?.db ?? this.database.db)
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.key, KEY));
    const parsed = MembershipSettings.safeParse(row?.value);
    return parsed.success ? parsed.data : DEFAULT_MEMBERSHIP_SETTINGS;
  }

  async updateSettings(operatorUserId: string, input: MembershipSettings): Promise<MembershipSettings> {
    const ids = input.plans.map((p) => p.planId);
    if (ids.join() !== PLAN_ORDER.join())
      throw new AppError('bad_request', '会员档位必须依次是月卡、季卡、年卡');
    if (input.plans.some((p) => p.firstPriceFen > p.priceFen))
      throw new AppError('bad_request', '首次价不能高于原价');
    const now = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db
        .insert(billingSettings)
        .values({ key: KEY, value: input, updatedAt: now, updatedBy: operatorUserId })
        .onConflictDoUpdate({
          target: billingSettings.key,
          set: { value: input, updatedAt: now, updatedBy: operatorUserId },
        });
      await this.audit.record(
        {
          module: 'billing',
          action: 'membership_settings.updated',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'billing_settings',
          targetId: null,
          details: { ...input },
        },
        tx,
      );
    });
    return input;
  }

  // ---------- 用户端 ----------

  async offer(userId: string): Promise<MembershipOffer> {
    const settings = await this.getSettings();
    const [first] = await this.database.db
      .select({ id: membershipOrders.id })
      .from(membershipOrders)
      .where(and(eq(membershipOrders.userId, userId), eq(membershipOrders.firstPurchase, true)));
    return {
      plans: settings.plans,
      firstPurchaseAvailable: !first,
      paymentEnabled: false,
      contactHint: settings.contactHint,
      membership: await this.membership.getMembership(userId),
    };
  }

  // ---------- 后台 ----------

  async listOrders(query: { userId?: string | undefined; cursor?: string | undefined; limit: number }) {
    const offset = query.cursor && /^\d{1,7}$/.test(query.cursor) ? Number(query.cursor) : 0;
    const rows = await this.database.db
      .select()
      .from(membershipOrders)
      .where(query.userId ? eq(membershipOrders.userId, query.userId) : undefined)
      .orderBy(desc(membershipOrders.createdAt), desc(membershipOrders.id))
      .limit(query.limit + 1)
      .offset(offset);
    return {
      items: rows.slice(0, query.limit).map(toOrder),
      nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
    };
  }

  async createOrder(operatorUserId: string, input: z.output<typeof CreateMembershipOrder>) {
    const order = await this.database.transaction(async (tx) => {
      // 锁顺序：用户钱包 → identity 用户行（extendProPlus 内）。同一用户的开通因此排队。
      const account = await this.ledger.lockUserAccount(tx, input.userId);
      const [existing] = await tx.db
        .select()
        .from(membershipOrders)
        .where(eq(membershipOrders.clientOrderId, input.clientOrderId));
      if (existing) {
        if (existing.userId !== input.userId || existing.planId !== input.planId)
          throw new AppError('conflict', '这个订单编号已用于另一笔开通');
        return existing;
      }
      const settings = await this.getSettings(tx);
      const plan = settings.plans.find((p) => p.planId === input.planId);
      if (!plan) throw new AppError('bad_request', '会员档位不存在');
      const [usedFirst] = await tx.db
        .select({ id: membershipOrders.id })
        .from(membershipOrders)
        .where(
          and(eq(membershipOrders.userId, input.userId), eq(membershipOrders.firstPurchase, true)),
        );
      const firstPurchase = !usedFirst && input.useFirstPrice !== false;
      const period = await this.membershipWrite.extendProPlus(
        { userId: input.userId, months: plan.months, operatorUserId },
        tx,
      );
      const id = newId();
      const now = this.clock.now();
      let ledgerEntryId: string | null = null;
      if (plan.bonusPoints > 0) {
        const { entry } = await this.ledger.postEntry(tx, account, {
          type: 'admin_grant',
          amountMicros: pointsToMicros(plan.bonusPoints),
          idempotencyKey: `membership_order:${id}`,
          purpose: 'membership_bonus',
          reason: `开通 PRO+ ${plan.name}赠送`,
          operatorUserId,
          bonusCredit: true,
        });
        ledgerEntryId = entry.id;
      }
      const [row] = await tx.db
        .insert(membershipOrders)
        .values({
          id,
          userId: input.userId,
          clientOrderId: input.clientOrderId,
          planId: plan.planId,
          priceFen: firstPurchase ? plan.firstPriceFen : plan.priceFen,
          listPriceFen: plan.priceFen,
          firstPurchase,
          bonusPoints: plan.bonusPoints,
          startsAt: new Date(period.startsAt),
          endsAt: new Date(period.endsAt),
          ledgerEntryId,
          operatorUserId,
          note: input.note ?? null,
          createdAt: now,
        })
        .returning();
      await this.audit.record(
        {
          module: 'billing',
          action: 'membership_order.created',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'user',
          targetId: input.userId,
          details: {
            orderId: id,
            planId: plan.planId,
            priceFen: row!.priceFen,
            firstPurchase,
            bonusPoints: plan.bonusPoints,
          },
        },
        tx,
      );
      return row!;
    });
    return {
      order: toOrder(order),
      membership: await this.membership.getMembership(input.userId),
    };
  }

  // ---------- 注册赠送 ----------

  /** 在注册事件的事务里调用：配置 > 0 才发；幂等（重放事件不重复发）。 */
  async grantSignupBonus(tx: DbTx, userId: string, timeZone?: string | null): Promise<void> {
    const { signupBonusPoints } = await this.getSettings(tx);
    if (signupBonusPoints <= 0) return;
    const key = SIGNUP_BONUS_KEY_PREFIX + userId;
    const account = await this.ledger.lockUserAccount(tx, userId, timeZone);
    if (await this.ledger.findByIdempotencyKey(tx, key)) return;
    await this.ledger.postEntry(tx, account, {
      type: 'admin_grant',
      amountMicros: pointsToMicros(signupBonusPoints),
      idempotencyKey: key,
      purpose: 'signup_bonus',
      reason: '注册赠送',
      bonusCredit: true,
    });
  }
}
