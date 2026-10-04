/**
 * 计费端口。提供方：billing。设计见 docs/architecture/billing.md 第 5–7 节，决策 ADR-0012。
 *
 * 调用权限（engineering-standards R9，CI 强制）：
 * - BillingReservationPort（estimateAndReserve / settle / release）：**只有 model-access 的模型网关**可以引用和调用。
 * - BillingReadPort（getSpendStatus）：ai-runtime 等需要判断「要不要安排后台任务」的模块可读。
 * 金额一律为整数微元（1 元 = 1,000,000）。
 * v1.1（T-020）：安全优先透支（ReserveInput.safetyOverdraft）、countAsBackground、release 返回平台吸收成本。
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

// v1.0：原 BillingPort（四个方法合在一起）删除，拆为上面两个端口。
