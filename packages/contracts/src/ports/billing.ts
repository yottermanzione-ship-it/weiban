/**
 * 计费端口。提供方：billing。设计见 docs/architecture/billing.md 第 5–7 节，决策 ADR-0012。
 *
 * 调用权限（engineering-standards R9，CI 强制）：
 * - BillingReservationPort（estimateAndReserve / settle / release）：**只有 model-access 的模型网关**可以引用和调用。
 * - BillingReadPort（getSpendStatus）：ai-runtime 等需要判断「要不要安排后台任务」的模块可读。
 * 金额一律为整数微元（1 元 = 1,000,000）。
 * v1.1（T-020）：安全优先透支（ReserveInput.safetyOverdraft）、countAsBackground、release 返回平台吸收成本。
 * v1.3（T-026）：SettleInput / ReleaseInput 新增可选 upstreamId；新增只读端口 BillingChargeQueryPort
 * （按用量记录 ID 查扣费、按北京日期列出扣费、列出当前价目表有价格的模型键）。
 */
import type { ModelPurpose } from './model-gateway.js';
import type { PortResult } from './common.js';

/** 计费账户：用户钱包，或平台账户（管理员侧任务）。 */
export type BillingAccountRef = { kind: 'user'; userId: string } | { kind: 'platform' };

/** 一次调用的用量（结算用；冻结时传估算值）。没有的单位不传。 */
export interface UsageQuantities {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  images?: number;
  ttsChars?: number;
  asrSeconds?: number;
  realtimeSeconds?: number;
  searchCalls?: number;
}

export interface ReserveInput {
  account: BillingAccountRef;
  purpose: ModelPurpose;
  modelKey: string;
  characterId?: string;
  /** 估算用量：输入 token 估算值 + maxOutputTokens 等。 */
  estimate: UsageQuantities;
  /** 与网关调用的幂等键相同：重复调用返回同一个冻结。 */
  idempotencyKey: string;
  /**
   * v1.1：安全优先透支（billing.md 6.6 节）。网关只在 GenerateTextInput.safetyPriority 合法时传 true；
   * billing 再校验一次（purpose ∈ SAFETY_OVERDRAFT_PURPOSES、account 为 user），不满足则按普通冻结处理。
   */
  safetyOverdraft?: boolean;
  /** v1.1：按后台功能计入后台每日上限（规则同 GenerateTextInput.countAsBackground）。 */
  countAsBackground?: boolean;
}

export interface ReserveOutput {
  holdId: string;
  amountMicros: number;
  priceVersionId: string;
  /** v1.1：这次冻结是否动用了安全优先透支额度（可用余额不足、靠透支才冻结成功）。 */
  usedSafetyOverdraft: boolean;
}

export type ReserveError =
  | 'insufficient_balance' // 可用余额不足
  | 'budget_exceeded' // 用户后台每日上限，或平台每日总上限
  | 'price_missing'; // 当前价目表没有该模型的价格（网关对外报 model_unavailable）

export interface SettleInput {
  holdId: string;
  /** model-access 的用量记录 ID：同一个 ID 只扣一次（幂等）。 */
  usageRecordId: string;
  actual: UsageQuantities;
  /** 调用开始时刻（ISO 8601），用于选择分时价。 */
  startedAt: string;
  /**
   * v1.3：这次调用实际走的上游（model-access 模型目录里的 upstreamId）。网关**应当**传；
   * billing 记在流水上，用于对账第 ③ 层按上游比对和「各上游近 30 天成本」（billing.md 8.2 节）。
   * 写成可选只为不让 1.2 的调用方编译失败；不传时这笔成本不计入任何上游。
   */
  upstreamId?: string;
}

export interface SettleOutput {
  ledgerEntryId: string;
  amountMicros: number;
  costMicros: number;
  balanceAfterMicros: number;
}

export interface ReleaseInput {
  holdId: string;
  reason: 'call_failed' | 'call_rejected' | 'cancelled';
  /** 上游对失败调用仍报告了用量时传入：按成本价记平台账户「吸收」，用户不付钱。 */
  upstreamUsage?: UsageQuantities;
  usageRecordId?: string;
  startedAt?: string;
  /** v1.3：同 SettleInput.upstreamId。传了 upstreamUsage（平台吸收）时网关应当一起传。 */
  upstreamId?: string;
}

/** v1.1：解冻结果。网关把平台吸收的成本记到用量记录上（管理后台用量页 ADM-08，billing.md 10.1 节）。 */
export interface ReleaseOutput {
  /** 失败调用仍被上游收费时由平台吸收的成本（微元）；没有则为 0。 */
  absorbedCostMicros: number;
}

export interface SpendStatus {
  availableMicros: number;
  /** 可用余额 ≤ 0。 */
  depleted: boolean;
  /**
   * 余额不足：depleted，或最近有冻结因余额不足被拒、之后还没加过钱（billing.md 6.3 第 3 条）。
   * 模型状态横条（reason = insufficient_balance）以它为准。
   */
  insufficient: boolean;
  backgroundRemainingTodayMicros: number;
}

/**
 * 扣费端口（冻结 / 结算 / 解冻）。**只有 model-access 可以引用这个类型和它的注入令牌**（R9，
 * engineering-standards.md 第 3.1 节）。v1.0 从原 BillingPort 拆出，让 lint 能按「谁 import 了它」检查，
 * 而不是按变量名猜（Q-009）。
 */
export interface BillingReservationPort {
  /**
   * 原子地冻结用户（或平台账户）的钱，同时预留平台每日成本预算（billing.md 第 7 节，Q-007）；
   * 任一不够即整体失败，不留半个冻结。
   */
  estimateAndReserve(input: ReserveInput): Promise<PortResult<ReserveOutput, ReserveError>>;
  settle(input: SettleInput): Promise<SettleOutput>;
  /** v1.1：返回值由 void 改为 ReleaseOutput（尚无实现，调用方可忽略返回值）。 */
  release(input: ReleaseInput): Promise<ReleaseOutput>;
}

/** 只读计费端口：任何模块都可以用（例如 ai-runtime 判断要不要安排后台任务）。 */
export interface BillingReadPort {
  getSpendStatus(userId: string): Promise<SpendStatus>;
}

/**
 * v1.3：一条调用扣费流水（type = charge）在对账与金额快照修复中的样子。
 * 每条用量记录最多一条用户扣费（absorbed = false）；失败调用可能有一条平台吸收（absorbed = true，记在平台账户）。
 */
export interface UsageCharge {
  usageRecordId: string;
  ledgerEntryId: string;
  /**
   * 扣费金额（正数微元）：absorbed = false 时是向计费账户收的售价金额（= settle 返回的 amountMicros）；
   * absorbed = true 时是平台吸收的成本（= release 返回的 absorbedCostMicros）。
   */
  amountMicros: number;
  /** 成本金额（微元）。 */
  costMicros: number;
  absorbed: boolean;
  safetyOverdraft: boolean;
  /** 流水写入时间（ISO 8601）。 */
  chargedAt: string;
}

/** v1.3：按北京日期分页列出扣费的结果。 */
export interface UsageChargePage {
  items: UsageCharge[];
  /** 下一页游标；null 表示没有更多。 */
  nextCursor: string | null;
}

/**
 * v1.3（T-026）：计费只读查询端口。提供方：billing；只读，不受 R9 限制，目前只有 model-access 需要。
 * 单独成接口（不并入 BillingReadPort），新增它不影响 BillingReadPort 已有的实现；billing 可以让同一个服务
 * 同时实现多个接口，注入令牌由后端在 billing 的 index.ts 定义。
 *
 * 用途（billing.md 4.1、8.2 节）：
 * - 对账第 ② 层：model-access 每天把自己的用量记录与这里的扣费逐条比对（billing 不能读 model-access 的表，
 *   也不能调用 model-access，所以由 model-access 比对，结果用事件 model_access.usage_reconciled 交回 billing）；
 * - 金额快照修复：用量记录上的金额快照缺失时，按这里的返回值补写；
 * - 启用模型前检查价目表：model-access 启用模型目录条目时，确认当前生效价目表里有这个模型的价格。
 */
export interface BillingChargeQueryPort {
  /** 按用量记录 ID 查扣费（一次最多 1,000 个 ID，超过抛异常）；没有扣费的 ID 不出现在结果里。 */
  getChargesByUsageRecordIds(usageRecordIds: readonly string[]): Promise<UsageCharge[]>;
  /**
   * 列出某个**北京时间**自然日（`YYYY-MM-DD`，与平台每日上限、供应商账单日一致）写入的全部调用扣费
   * （含平台吸收），按（写入时间, 流水 ID）升序分页；limit 默认 500、最大 1,000。
   * 跨零点的调用：流水按写入时刻归日，用量记录按创建时刻归日；比对方按 usageRecordId 精确匹配，
   * 当天对不上的再用 getChargesByUsageRecordIds 查一次，不要按日期判定缺失。
   */
  listChargesByDay(
    day: string,
    page?: { cursor?: string; limit?: number },
  ): Promise<UsageChargePage>;
  /** 当前生效价目表中至少有一条价格的模型键（去重）；没有生效的价目表时为空数组。 */
  listActivePricedModelKeys(): Promise<string[]>;
}

// v1.0：原 BillingPort（四个方法合在一起）删除，拆为上面两个端口。
