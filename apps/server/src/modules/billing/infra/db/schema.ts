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
    lowBalanceThresholdMicros: money('low_balance_threshold_micros').notNull(),
    backgroundDailyLimitMicros: money('background_daily_limit_micros').notNull(),
    /** 用户时区（每次冻结时从 identity 资料刷新），用于后台每日上限、余额提醒的「当天」。 */
    timeZone: text('time_zone').notNull(),
    /** 最近一次因余额不足拒绝冻结的时间；发出 balance_restored 后清空（billing.md 6.3 第 3 条）。 */
    insufficientSince: tz('insufficient_since'),
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
  },
  (t) => [
    uniqueIndex('holds_idempotency_key_key').on(t.idempotencyKey),
    index('holds_account_status_idx').on(t.accountId, t.status),
    index('holds_active_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
    check('holds_status_check', sql`${t.status} in ('active', 'settled', 'released', 'expired')`),
    check('holds_amount_positive', sql`${t.amountMicros} > 0`),
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
    reservedCostMicros: money('reserved_cost_micros').notNull(),
    /** 当天是否已发过 80% 提醒。 */
    alertSentAt: tz('alert_sent_at'),
  },
  (t) => [check('platform_daily_budget_reserved_nonnegative', sql`${t.reservedCostMicros} >= 0`)],
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
