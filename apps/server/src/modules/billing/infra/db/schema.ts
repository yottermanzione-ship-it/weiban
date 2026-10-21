/**
 * billing 模块的表（PostgreSQL schema `billing`，billing.md 第 2、4、5、7、8 节）。
 * 表说明见 docs/backend/billing.md 第 3 节。只有 billing 模块能读写；别的模块用 BillingReadPort / 计费端口。
 *
 * 金额一律 bigint 微元（mode: number，安全范围 ±9e15 微元 = ±90 亿元，足够）。
 * 流水表 ledger_entries 只增不改：迁移里用触发器拒绝 UPDATE / DELETE / TRUNCATE（见 0002_billing.sql 末尾）。
 *
 * 改表结构：改这里 → `pnpm --filter @weiban/server db:generate` 生成迁移 → 手写对应的 .down.sql。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const billingSchema = pgSchema('billing');

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });

/** 账户：每个用户一个钱包（kind = user），全平台一个平台账户（kind = platform）。 */
export const accounts = billingSchema.table(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    /** user / platform */
    kind: text('kind').notNull(),
    /** 用户钱包的用户 ID；平台账户为空。 */
    userId: uuid('user_id'),
    balanceMicros: money('balance_micros').notNull(),
    heldMicros: money('held_micros').notNull(),
    /** 会员 v5（0104）：余额里属于赠送积分的部分（开通 PRO+、注册赠送）；扣费先扣它，0 ≤ 它 ≤ max(余额,0)。 */
    bonusBalanceMicros: money('bonus_balance_micros').notNull().default(0),
    lowBalanceThresholdMicros: money('low_balance_threshold_micros').notNull(),
    backgroundDailyLimitMicros: money('background_daily_limit_micros').notNull(),
    /** 用户时区（每次冻结时从 identity 资料刷新），用于后台每日上限、余额提醒的「当天」。 */
    timeZone: text('time_zone').notNull(),
    /** 最近一次因余额不足拒绝冻结的时间；发出 balance_restored 后清空（billing.md 6.3 第 3 条）。 */
    insufficientSince: tz('insufficient_since'),
    ecologyInsufficientSince: tz('ecology_insufficient_since'),
    ecologyNoticePending: boolean('ecology_notice_pending').notNull().default(false),
    /** 最近一次发出 balance_low 的当地日期（同一天最多一次）。 */
    lowNotifiedOn: date('low_notified_on', { mode: 'string' }),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
    /** 每次改账户行加一（排查用；并发安全靠行锁 SELECT ... FOR UPDATE）。 */
    version: integer('version').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_user_id_key').on(t.userId),
    uniqueIndex('accounts_single_platform_key')
      .on(t.kind)
      .where(sql`${t.kind} = 'platform'`),
    check('accounts_kind_check', sql`${t.kind} in ('user', 'platform')`),
    check(
      'accounts_owner_check',
      sql`(${t.kind} = 'user' and ${t.userId} is not null) or (${t.kind} = 'platform' and ${t.userId} is null)`,
    ),
    check('accounts_held_nonnegative', sql`${t.heldMicros} >= 0`),
  ],
);

/** 流水（只增不改）。余额 = 本账户流水合计（对账第 ① 层核对）。 */
export const ledgerEntries = billingSchema.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull(),
    /** admin_grant / admin_deduct / charge / refund / adjustment */
    type: text('type').notNull(),
    /** 加钱为正，扣钱为负。 */
    amountMicros: money('amount_micros').notNull(),
    balanceAfterMicros: money('balance_after_micros').notNull(),
    /** 全局唯一：charge:{usageRecordId} / absorbed:{holdId} / admin:{userId}:{key} 等。 */
    idempotencyKey: text('idempotency_key').notNull(),
    usageRecordId: uuid('usage_record_id'),
    holdId: uuid('hold_id'),
    purpose: text('purpose'),
    modelKey: text('model_key'),
    characterId: uuid('character_id'),
    priceVersionId: uuid('price_version_id'),
    /** 上游 ID（对账第 ③ 层、平台花费按上游汇总；待契约 SettleInput 增加 upstreamId 后由网关传入）。 */
    upstreamId: uuid('upstream_id'),
    /** 这笔调用的成本金额（用户不可见）。 */
    costMicros: money('cost_micros'),
    /** 平台账户上「失败调用仍被上游收费」的记录（billing.md 6.5）。 */
    absorbed: boolean('absorbed').notNull(),
    /** 这笔扣费动用了安全优先透支（billing.md 6.6）。 */
    safetyOverdraft: boolean('safety_overdraft').notNull(),
    /** 管理员操作的原因 / 冲正说明（用户可见的 note）。 */
    reason: text('reason'),
    operatorUserId: uuid('operator_user_id'),
    /** 会员 v5（0104）：本条流水对赠送积分的变化量（加赠送为正、先扣赠送为负）。 */
    bonusDeltaMicros: money('bonus_delta_micros').notNull().default(0),
  },
  (t) => [
    uniqueIndex('ledger_entries_idempotency_key_key').on(t.idempotencyKey),
    // 同一条用量记录只扣一次（结算幂等，billing.md 5.3 / 6.2）
    uniqueIndex('ledger_entries_usage_charge_key')
      .on(t.usageRecordId)
      .where(sql`${t.type} = 'charge' and ${t.absorbed} = false`),
    index('ledger_entries_account_created_idx').on(t.accountId, t.createdAt, t.id),
    index('ledger_entries_created_idx').on(t.createdAt),
    index('ledger_entries_usage_record_idx').on(t.usageRecordId),
    check(
      'ledger_entries_type_check',
      sql`${t.type} in ('admin_grant', 'admin_deduct', 'charge', 'refund', 'adjustment')`,
    ),
  ],
);

/** 冻结记录（预授权）。冻结不写流水，只改账户的 held_micros。 */
export const holds = billingSchema.table(
  'holds',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    amountMicros: money('amount_micros').notNull(),
    purpose: text('purpose').notNull(),
    modelKey: text('model_key').notNull(),
    characterId: uuid('character_id'),
    /** 与网关调用的幂等键相同：重复冻结返回同一个冻结。 */
    idempotencyKey: text('idempotency_key').notNull(),
    priceVersionId: uuid('price_version_id').notNull(),
    /** active / settled / released / expired */
    status: text('status').notNull(),
    createdAt: tz('created_at').notNull(),
    expiresAt: tz('expires_at').notNull(),
    /** 平台每日成本预算：所属北京日期与预留的成本（billing.md 第 7 节第 2 条）。 */
    budgetDay: date('budget_day', { mode: 'string' }).notNull(),
    reservedCostMicros: money('reserved_cost_micros').notNull(),
    /** 是否计入用户后台每日上限，以及计入哪一天（用户当地日期）。 */
    countsAsBackground: boolean('counts_as_background').notNull(),
    backgroundDay: date('background_day', { mode: 'string' }),
    safetyOverdraft: boolean('safety_overdraft').notNull(),
    /** 结算 / 解冻 / 过期的时间与结果。 */
    closedAt: tz('closed_at'),
    ledgerEntryId: uuid('ledger_entry_id'),
    releaseReason: text('release_reason'),
    absorbedCostMicros: money('absorbed_cost_micros'),
    /** 3.16：冻结依据/确定结算结果；旧hold为空，不能补造上限证明。 */
    limitSnapshot: jsonb('limit_snapshot').$type<{
      usage: import('@weiban/contracts').UsageQuantities;
      evidence: string;
      pricingModels?: string[];
    }>(),
    riskSnapshot: jsonb('risk_snapshot').$type<import('@weiban/contracts').CallRiskSnapshot>(),
    releaseSnapshot: jsonb('release_snapshot').$type<import('@weiban/contracts').ReleaseOutput>(),
    settlementSnapshot:
      jsonb('settlement_snapshot').$type<import('@weiban/contracts').SettleOutput>(),
    /** 3.22（0116）：冻结时锁定的限时折扣（× 10000，10000 = 原价）；结算按它计售价。 */
    discountBp: integer('discount_bp').notNull().default(10000),
    /**
     * 3.27（0126，H1）：先用后扣。true = 不冻结积分（amount_micros = 0），结算按实际用量全额扣、余额可以变负；
     * 只用于幂等、并发计数与结算关联。旧冻结为 false，照旧规则处理。
     */
    postpaid: boolean('postpaid').notNull().default(false),
    /** 3.27：调用前按实际发送的上下文 + 最大输出估的售价（异常巨额拦截、排查用；不冻结）。 */
    estimateMicros: money('estimate_micros').notNull().default(0),
  },
  (t) => [
    uniqueIndex('holds_idempotency_key_key').on(t.idempotencyKey),
    index('holds_account_status_idx').on(t.accountId, t.status),
    index('holds_unknown_route_idx')
      .on(sql`(${t.riskSnapshot}->>'upstreamId')`, sql`(${t.riskSnapshot}->>'upstreamModelId')`)
      .where(sql`${t.riskSnapshot}->>'phase' = 'unknown'`),
    index('holds_active_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    check('holds_status_check', sql`${t.status} in ('active', 'settled', 'released', 'expired')`),
    check('holds_amount_nonnegative', sql`${t.amountMicros} >= 0`),
    check('holds_estimate_nonnegative', sql`${t.estimateMicros} >= 0`),
  ],
);

/** 每个账户每个当地日期的花费汇总（后台每日上限「今天已结算」）。 */
export const dailySpend = billingSchema.table(
  'daily_spend',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    backgroundSettledMicros: money('background_settled_micros').notNull(),
    totalChargedMicros: money('total_charged_micros').notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.day] })],
);

/** 平台每日成本预算：已结算 + 预留中（原子预留，billing.md 第 7 节第 2 条，Q-007）。 */
export const platformDailyBudget = billingSchema.table(
  'platform_daily_budget',
  {
    budgetDay: date('budget_day', { mode: 'string' }).primaryKey(),
    capMicros: money('cap_micros').notNull(),
    settledCostMicros: money('settled_cost_micros').notNull(),
    uncertainCostMicros: money('uncertain_cost_micros').notNull().default(0),
    reservedCostMicros: money('reserved_cost_micros').notNull(),
    /** 当天是否已发过 80% 提醒。 */
    alertSentAt: tz('alert_sent_at'),
  },
  (t) => [
    check('platform_daily_budget_reserved_nonnegative', sql`${t.reservedCostMicros} >= 0`),
    check('platform_daily_budget_uncertain_nonnegative', sql`${t.uncertainCostMicros} >= 0`),
  ],
);

/** 价目表版本。任一时刻只有一个 active；已生效过的版本不可修改。 */
export const priceVersions = billingSchema.table(
  'price_versions',
  {
    id: uuid('id').primaryKey(),
    versionLabel: text('version_label').notNull(),
    /** draft / active / retired */
    status: text('status').notNull(),
    effectiveFrom: tz('effective_from'),
    note: text('note'),
    createdAt: tz('created_at').notNull(),
    createdBy: uuid('created_by'),
    retiredAt: tz('retired_at'),
  },
  (t) => [
    uniqueIndex('price_versions_single_active_key')
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
    check('price_versions_status_check', sql`${t.status} in ('draft', 'active', 'retired')`),
  ],
);

/** 价格：版本 × 模型键 × 计价单位（× 可选时段）→ 成本价、售价。 */
export const priceItems = billingSchema.table(
  'price_items',
  {
    id: uuid('id').primaryKey(),
    priceVersionId: uuid('price_version_id')
      .notNull()
      .references(() => priceVersions.id, { onDelete: 'cascade' }),
    modelKey: text('model_key').notNull(),
    unit: text('unit').notNull(),
    /** 契约 PriceTimeBand；null = 全天价。 */
    band: jsonb('band'),
    priceMicros: money('price_micros').notNull(),
    costMicros: money('cost_micros').notNull(),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [index('price_items_version_model_idx').on(t.priceVersionId, t.modelKey)],
);

/** 管理员录入的上游实际账单（对账第 ③ 层）。 */
export const upstreamBills = billingSchema.table(
  'upstream_bills',
  {
    id: uuid('id').primaryKey(),
    upstreamId: uuid('upstream_id').notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    amountMicros: money('amount_micros').notNull(),
    note: text('note'),
    createdAt: tz('created_at').notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [index('upstream_bills_period_idx').on(t.periodEnd)],
);

/** 每日对账结果（每个北京日期一行，重跑覆盖）。details 存异常明细（账户 ID、差额），只给管理员看。 */
export const reconciliationRuns = billingSchema.table(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey(),
    runDate: date('run_date', { mode: 'string' }).notNull(),
    ledgerConsistent: boolean('ledger_consistent').notNull(),
    staleHolds: integer('stale_holds').notNull(),
    usageWithoutCharge: integer('usage_without_charge').notNull(),
    chargeWithoutUsage: integer('charge_without_usage').notNull(),
    usageReconciledAt: tz('usage_reconciled_at'),
    usageAmountMismatch: integer('usage_amount_mismatch').notNull().default(0),
    upstreamDiffs: jsonb('upstream_diffs').notNull(),
    absorbedMicros: money('absorbed_micros').notNull(),
    details: jsonb('details').notNull(),
    diffRatioThreshold: doublePrecision('diff_ratio_threshold').notNull(),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [uniqueIndex('reconciliation_runs_run_date_key').on(t.runDate)],
);

/** 3.22（0116）：模型限时折扣。只作用于售价，成本不变；[starts_at, ends_at) 生效。 */
export const modelDiscounts = billingSchema.table('model_discounts', {
  modelKey: text('model_key').primaryKey(),
  /** 折扣系数 × 10000（5000 = 5 折）。 */
  rateBp: integer('rate_bp').notNull(),
  startsAt: tz('starts_at').notNull(),
  endsAt: tz('ends_at').notNull(),
  updatedAt: tz('updated_at').notNull(),
  updatedBy: uuid('updated_by'),
});

/** v3.3（0088，ADR-0032）：计费的后台配置（键值）。recharge_options = 充值档位、赠送比例、联系管理员说明。 */
export const billingSettings = billingSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tz('updated_at').notNull(),
  updatedBy: uuid('updated_by'),
});

/**
 * 3.8（0092，总对照表 Q5）：服务费冻结（BillingServiceFeePort）。固定金额、不过期，直到调用方扣除或退回。
 * 冻结计入 accounts.held_micros（对账第 ① 层把它和 holds 一起算）；扣除时写一条 charge 流水（purpose = service_fee）。
 */
export const feeHolds = billingSchema.table(
  'fee_holds',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** 服务种类（契约 ServiceFeeKind）。 */
    kind: text('kind').notNull(),
    amountMicros: money('amount_micros').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    /** 用户可见说明（写到扣费流水的 reason）。 */
    note: text('note').notNull(),
    /** active / settled / released */
    status: text('status').notNull(),
    createdAt: tz('created_at').notNull(),
    closedAt: tz('closed_at'),
    ledgerEntryId: uuid('ledger_entry_id'),
  },
  (t) => [
    uniqueIndex('fee_holds_idempotency_key_key').on(t.idempotencyKey),
    index('fee_holds_account_status_idx').on(t.accountId, t.status),
    check('fee_holds_status_check', sql`${t.status} in ('active', 'settled', 'released')`),
    check('fee_holds_amount_positive', sql`${t.amountMicros} > 0`),
  ],
);

/** 会员 v5（0104，16 号 §3）：PRO+ 开通订单。现阶段无真实支付，由管理员替用户开通；开通即一次性发赠送积分。 */
export const membershipOrders = billingSchema.table(
  'membership_orders',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** 后台提交的幂等键：重复提交返回同一订单。 */
    clientOrderId: uuid('client_order_id').notNull(),
    /** month / quarter / year */
    planId: text('plan_id').notNull(),
    /** 本单实收价（分）。 */
    priceFen: integer('price_fen').notNull(),
    /** 当时的原价（分）。 */
    listPriceFen: integer('list_price_fen').notNull(),
    /** 是否按首次价（每人限一次，部分唯一索引保证）。 */
    firstPurchase: boolean('first_purchase').notNull(),
    bonusPoints: integer('bonus_points').notNull(),
    startsAt: tz('starts_at').notNull(),
    endsAt: tz('ends_at').notNull(),
    ledgerEntryId: uuid('ledger_entry_id'),
    operatorUserId: uuid('operator_user_id'),
    note: text('note'),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('membership_orders_client_order_key').on(t.clientOrderId),
    uniqueIndex('membership_orders_first_purchase_key')
      .on(t.userId)
      .where(sql`${t.firstPurchase}`),
    index('membership_orders_user_idx').on(t.userId, t.createdAt),
    index('membership_orders_created_idx').on(t.createdAt),
    check('membership_orders_plan_check', sql`${t.planId} in ('month', 'quarter', 'year')`),
  ],
);

/** H4: one supplier usage, immutable payer snapshot, precision carry. */
export const sharedSearchCalls = billingSchema.table(
  'shared_search_calls',
  {
    id: uuid('id').primaryKey(),
    requestKey: text('request_key').notNull().unique(),
    characterId: uuid('character_id').notNull(),
    modelKey: text('model_key').notNull(),
    state: text('state').notNull(),
    memberCount: integer('member_count').notNull(),
    ceilingMicros: money('ceiling_micros').notNull(),
    usageRecordId: uuid('usage_record_id').unique(),
    collectedMicros: money('collected_micros').notNull().default(0),
    createdAt: tz('created_at').notNull(),
    expiresAt: tz('expires_at').notNull(),
  },
  (t) => [
    check('shared_search_state', sql`${t.state} IN ('pending','settled','cancelled')`),
    check('shared_search_members_positive', sql`${t.memberCount}>0`),
  ],
);
export const sharedSearchMembers = billingSchema.table(
  'shared_search_members',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => sharedSearchCalls.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    chargedMicros: money('charged_micros').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.accountId] }),
    index('shared_search_members_account_idx').on(t.accountId),
  ],
);
export const sharedSearchCarries = billingSchema.table(
  'shared_search_carries',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull(),
    carryMicros: integer('carry_micros').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.characterId] }),
    check('shared_search_carry_range', sql`${t.carryMicros} BETWEEN -50 AND 99`),
  ],
);
