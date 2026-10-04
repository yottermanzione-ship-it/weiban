/**
 * billing 模块：钱包余额、流水、价目表、用量汇总；管理后台的加扣余额、价目表版本、上游账单、对账。
 * 设计见 docs/architecture/billing.md，决策 ADR-0012。
 *
 * 金额一律为整数「微元」：1 元 = 1,000,000 微元（字段名以 Micros 结尾）。客户端显示时统一换算，
 * 不要用浮点数做加减。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, Timestamp, cursorPage, defineEndpoint } from '../common.js';
import { ModelKey } from './model-access.js';

// ---------- 基础类型 ----------

/** 金额（微元），可正可负。 */
export const MoneyMicros = z.number().int();
/** 正金额（微元）。 */
export const PositiveMoneyMicros = z.number().int().positive();

export const MICROS_PER_YUAN = 1_000_000 as const;

/** 计费用途分组（用量页按此分类）。与 ports/model-gateway.ts 的 ModelPurpose 一一对应，由服务器换算。 */
export const SpendCategory = z.enum(['chat', 'background', 'media', 'import', 'safety', 'admin']);

// ---------- 钱包 ----------

export const Wallet = z.object({
  balanceMicros: MoneyMicros,
  /** 正在进行中的调用冻结的金额。 */
  heldMicros: z.number().int().nonnegative(),
  /** 可用余额 = 余额 − 冻结；≤ 0 时所有模型调用被拒绝。 */
  availableMicros: MoneyMicros,
  lowBalanceThresholdMicros: z.number().int().nonnegative(),
  backgroundBudget: z.object({
    /** 后台每日上限（默认值见 docs/ai/cost-estimate.md）。 */
    dailyLimitMicros: z.number().int().nonnegative(),
    /** 今天（用户时区）后台已花费（已结算 + 冻结中）。 */
    spentTodayMicros: z.number().int().nonnegative(),
    /** 下一次重置时间（用户时区的次日 0 点）。 */
    resetsAt: Timestamp,
  }),
  updatedAt: Timestamp,
});
export type Wallet = z.infer<typeof Wallet>;

export const UpdateWalletSettingsRequest = z.object({
  lowBalanceThresholdMicros: z.number().int().nonnegative().optional(),
  backgroundDailyLimitMicros: z.number().int().nonnegative().optional(),
});

// ---------- 流水 ----------

export const LedgerEntryType = z.enum([
  'admin_grant', // 管理员加余额（充值记录）
  'admin_deduct', // 管理员扣余额
  'charge', // 模型调用扣费
  'refund', // 退款（例如对账发现多扣）
  'adjustment', // 冲正
]);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

/** 用户可见的一条流水。成本价、上游信息不对用户返回。 */
export const LedgerEntry = z.object({
  entryId: Id,
  type: LedgerEntryType,
  /** 加钱为正，扣钱为负。 */
  amountMicros: MoneyMicros,
  balanceAfterMicros: MoneyMicros,
  /** 扣费类：用途分组、模型、角色。 */
  category: SpendCategory.nullable(),
  modelKey: ModelKey.nullable(),
  characterId: Id.nullable(),
  /** 管理员操作的原因 / 冲正说明。 */
  note: z.string().max(200).nullable(),
  createdAt: Timestamp,
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;

// ---------- 价目表 ----------

export const PriceUnit = z.enum([
  'input_tokens_per_million',
  'cached_input_tokens_per_million',
  'output_tokens_per_million',
  'image',
  'tts_10k_chars',
  'asr_minute',
  'realtime_minute',
  'search_call',
]);
export type PriceUnit = z.infer<typeof PriceUnit>;

/** 分时段（例如高峰价）。时间按供应商规定的时区（通常北京时间），weekdays 1=周一…7=周日。 */
export const PriceTimeBand = z.object({
  name: z.string().max(16),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/** 用户可见的价格（售价）。 */
export const PublicPriceItem = z.object({
  modelKey: ModelKey,
  unit: PriceUnit,
  priceMicros: z.number().int().nonnegative(),
  /** null = 全天同价；否则只在该时段生效，其余时段取同模型同单位、band 为 null 的那条。 */
  band: PriceTimeBand.nullable(),
});

export const PriceTable = z.object({
  priceVersionId: Id,
  versionLabel: z.string(),
  effectiveFrom: Timestamp,
  items: z.array(PublicPriceItem),
});
export type PriceTable = z.infer<typeof PriceTable>;

// ---------- 用量汇总 ----------

export const UsageSummaryQuery = z.object({
  from: LocalDate,
  to: LocalDate,
  groupBy: z.enum(['day', 'character', 'category', 'model']),
});

export const UsageSummaryRow = z.object({
  /** groupBy 对应的键：日期 / characterId / 分组名 / modelKey。 */
  key: z.string(),
  amountMicros: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
});

// ---------- 用户端接口 ----------

export const BillingEndpoints = {
  getWallet: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/billing/wallet`,
    auth: 'user',
    response: Wallet,
    summary: '我的余额、冻结、可用、提醒线、后台每日上限与今日已用',
  }),
  updateWalletSettings: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/billing/wallet/settings`,
    auth: 'user',
    body: UpdateWalletSettingsRequest,
    response: Wallet,
    summary: '修改余额提醒线、后台每日上限',
  }),
  listLedger: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/billing/ledger`,
    auth: 'user',
    query: z.object({
      type: z.enum(['topup', 'spend', 'all']).default('all'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    response: cursorPage(LedgerEntry),
    summary: '流水（按时间倒序）。topup = 加余额类，spend = 扣费类',
  }),
  getPrices: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/billing/prices`,
    auth: 'user',
    response: PriceTable,
    summary: '当前生效的价目表（售价），用于模型选择页、排行榜展示价格',
  }),
  getUsageSummary: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/billing/usage-summary`,
    auth: 'user',
    query: UsageSummaryQuery,
    response: z.object({ rows: z.array(UsageSummaryRow), totalMicros: z.number().int().nonnegative() }),
    summary: '按天 / 角色 / 用途 / 模型汇总的花费（用量页）',
  }),
} as const;

// ---------- 管理后台 ----------

export const AdminAccountSummary = z.object({
  userId: Id,
  username: z.string(),
  balanceMicros: MoneyMicros,
  heldMicros: z.number().int().nonnegative(),
  spentLast30DaysMicros: z.number().int().nonnegative(),
  updatedAt: Timestamp,
});

/** 管理后台看到的流水：比用户多成本价、操作人、是否平台吸收。 */
export const AdminLedgerEntry = LedgerEntry.extend({
  costMicros: z.number().int().nonnegative().nullable(),
  usageRecordId: Id.nullable(),
  priceVersionId: Id.nullable(),
  operatorUserId: Id.nullable(),
  /** 平台账户上的「失败调用仍被上游收费」记录。 */
  absorbed: z.boolean(),
});

export const AdminAdjustmentRequest = z.object({
  direction: z.enum(['grant', 'deduct']),
  amountMicros: PositiveMoneyMicros,
  reason: z.string().min(2).max(200),
  /** 后台页面生成的幂等键，重复提交只记一次。 */
  idempotencyKey: z.string().min(8).max(64),
});

export const AdminPriceItem = PublicPriceItem.extend({
  /** 成本价（上游收平台的钱），对账用。 */
  costMicros: z.number().int().nonnegative(),
});

export const PriceVersionStatus = z.enum(['draft', 'active', 'retired']);

export const AdminPriceVersion = z.object({
  priceVersionId: Id,
  versionLabel: z.string().min(1).max(32),
  status: PriceVersionStatus,
  effectiveFrom: Timestamp.nullable(),
  note: z.string().max(200).nullable(),
  items: z.array(AdminPriceItem),
  createdAt: Timestamp,
});

export const UpstreamBill = z.object({
  billId: Id,
  upstreamId: Id,
  periodStart: LocalDate,
  periodEnd: LocalDate,
  amountMicros: z.number().int().nonnegative(),
  note: z.string().max(200).nullable(),
  createdAt: Timestamp,
});

export const ReconciliationRun = z.object({
  runId: Id,
  date: LocalDate,
  ledgerConsistent: z.boolean(),
  staleHolds: z.number().int().nonnegative(),
  usageWithoutCharge: z.number().int().nonnegative(),
  chargeWithoutUsage: z.number().int().nonnegative(),
  upstreamDiffs: z.array(
    z.object({
      upstreamId: Id,
      periodStart: LocalDate,
      periodEnd: LocalDate,
      billedMicros: z.number().int().nonnegative(),
      computedCostMicros: z.number().int().nonnegative(),
      diffRatio: z.number(),
      flagged: z.boolean(),
    }),
  ),
  absorbedMicros: z.number().int().nonnegative(),
  createdAt: Timestamp,
});

export const BillingAdminEndpoints = {
  listAccounts: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/billing/accounts`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminAccountSummary) }),
    summary: '所有用户的余额概况',
  }),
  adjustBalance: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/billing/accounts/:userId/adjustments`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    body: AdminAdjustmentRequest,
    response: AdminLedgerEntry,
    summary: '管理员加 / 扣余额（必填原因，幂等）；扣减额不能超过可用余额（422）；写审计日志',
  }),
  listAccountLedger: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/billing/accounts/:userId/ledger`,
    auth: 'admin',
    params: z.object({ userId: Id }),
    query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    response: cursorPage(AdminLedgerEntry),
    summary: '某用户的完整流水（含成本价）',
  }),
  listPriceVersions: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/billing/price-versions`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminPriceVersion) }),
    summary: '价目表版本列表',
  }),
  createPriceVersion: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/billing/price-versions`,
    auth: 'admin',
    body: z.object({
      versionLabel: z.string().min(1).max(32),
      note: z.string().max(200).nullable(),
      items: z.array(AdminPriceItem),
    }),
    response: AdminPriceVersion,
    summary: '新建价目表草稿（调价 = 复制当前版本修改后新建）',
  }),
  updatePriceDraft: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/billing/price-versions/:priceVersionId`,
    auth: 'admin',
    params: z.object({ priceVersionId: Id }),
    body: z.object({ note: z.string().max(200).nullable().optional(), items: z.array(AdminPriceItem).optional() }),
    response: AdminPriceVersion,
    summary: '修改草稿；已生效或已停用的版本不可修改（409）',
  }),
  activatePriceVersion: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/billing/price-versions/:priceVersionId/activate`,
    auth: 'admin',
    params: z.object({ priceVersionId: Id }),
    body: z.object({ effectiveFrom: Timestamp.nullable() }),
    response: AdminPriceVersion,
    summary: '发布价目表（null = 立即生效）；原生效版本自动停用。目录中启用的模型缺少价格时 422',
  }),
  createUpstreamBill: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/billing/upstream-bills`,
    auth: 'admin',
    body: UpstreamBill.omit({ billId: true, createdAt: true }),
    response: UpstreamBill,
    summary: '录入上游实际账单金额（用于第 ③ 层对账）',
  }),
  listReconciliation: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/billing/reconciliation`,
    auth: 'admin',
    query: z.object({ from: LocalDate, to: LocalDate }),
    response: z.object({ items: z.array(ReconciliationRun) }),
    summary: '每日对账结果',
  }),
  getPlatformSummary: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/billing/platform-summary`,
    auth: 'admin',
    response: z.object({
      todayCostMicros: z.number().int().nonnegative(),
      dailyCapMicros: z.number().int().nonnegative(),
      platformAccountBalanceMicros: MoneyMicros,
      last30DaysCostByUpstream: z.array(z.object({ upstreamId: Id, costMicros: z.number().int().nonnegative() })),
    }),
    summary: '平台今日成本、每日上限、平台账户、各上游近 30 天成本',
  }),
} as const;
