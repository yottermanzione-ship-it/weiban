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
import type { PortResult, Tx } from './common.js';

/** 计费账户：用户钱包，或平台账户（管理员侧任务）。 */
export type BillingAccountRef = { kind: 'user'; userId: string } | { kind: 'platform' };

/** 一次调用的用量（结算用；冻结时传估算值）。没有的单位不传。 */
export interface UsageQuantities {
  inputTokens?: number;
  cachedInputTokens?: number;
  /** 3.24：缓存写入 token（Anthropic 原生协议报告，5 分钟 / 1 小时两档）；按缓存写入价计，没定价按普通输入价。 */
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
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
  /** 3.16：由网关核准路由得出的可计费上限；缺失时拒绝新冻结，旧estimate不再充当上限。 */
  ceiling?: { usage: UsageQuantities; evidence: string; pricingModels?: string[] };
  /** 网关自动重试预留供应商风险；不是客户端可选的付款钱包。 */
  reservePlatformRisk?: boolean;
  /** 同一逻辑请求后续attempt沿用首次已生效且不可变的价目表。 */
  priceVersionId?: string;
  /** 与网关调用的幂等键相同：重复调用返回同一个冻结。 */
  idempotencyKey: string;
  /**
   * 3.16兼容字段：已取消透支，传true也不能获得额外可用余额。
   */
  safetyOverdraft?: boolean;
  /** v1.1：按后台功能计入后台每日上限（规则同 GenerateTextInput.countAsBackground）。 */
  countAsBackground?: boolean;
  /** 3.16：服务端明确的角色自主生态任务，独立于dailyLimit分类；仅此来源余额不足记一次生态提示。 */
  ecologyTask?: boolean;
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
  /** 3.16：供应商未报有效用量且无核准精确本地计数时false，不按经验估算扣用户。 */
  actualKnown?: boolean;
  /**
   * 3.26（G3-2）：actual 是网关按本地分词估算的用量（上游没报）。按估算计费（仍不超过冻结额度、不透支），
   * 结算快照标记 usageEstimated，对账单列条数；不进入「待核成本」，也不暂停线路。与 actualKnown = false 互斥。
   */
  actualEstimated?: boolean;
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
  /** 3.16：成本归属和理论少收分开；两份ledger成本之和=已知供应商成本。 */
  chargedCostMicros?: number;
  absorbedCostMicros?: number;
  theoreticalMicros?: number;
  waivedMicros?: number;
  costKnown?: boolean;
  uncertainCostMicros?: number;
  unpricedUnits?: string[];
  /** 3.26：这次按本地估算用量结算（上游没报用量）。 */
  usageEstimated?: boolean;
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
  /** 3.26：upstreamUsage 是本地估算（上游没报）；平台按估算吸收成本，快照标记 usageEstimated。 */
  upstreamUsageEstimated?: boolean;
}

/** v1.1：解冻结果。网关把平台吸收的成本记到用量记录上（管理后台用量页 ADM-08，billing.md 10.1 节）。 */
export interface ReleaseOutput {
  /** 失败调用仍被上游收费时由平台吸收的成本（微元）；没有则为 0。 */
  absorbedCostMicros: number;
  /** 3.16：未知用量/缺价格不能被解释成已知零成本。 */
  costKnown?: boolean;
  uncertainCostMicros?: number;
  unpricedUnits?: string[];
  /** 3.26：成本按本地估算用量计。 */
  usageEstimated?: boolean;
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
export interface CallRiskSnapshot {
  phase: 'reserved' | 'sent' | 'unknown' | 'resolved';
  costUpperMicros: number;
  uncertainMicros: number;
  usageRecordId?: string;
  upstreamId?: string;
  upstreamModelId?: string;
  sentAt?: string;
  /** 人工核实只追加成本差额，不追扣用户。 */
  resolution?: {
    costMicros: number;
    evidenceUrl: string;
    reason: string;
    operatorUserId: string;
    resolvedAt: string;
  };
}
export interface BillingReservationPort {
  /** 3.16：外部请求发出前原子标记，只允许active未过期且从未发出的hold。重复返回false，不可重发。 */
  beginCall?(input: {
    holdId: string;
    usageRecordId: string;
    upstreamId: string;
    upstreamModelId: string;
  }): Promise<boolean>;

  /**
   * 原子地冻结用户（或平台账户）的钱，同时预留平台每日成本预算（billing.md 第 7 节，Q-007）；
   * 任一不够即整体失败，不留半个冻结。
   */
  estimateAndReserve(input: ReserveInput): Promise<PortResult<ReserveOutput, ReserveError>>;
  settle(input: SettleInput): Promise<SettleOutput>;
  /** v1.1：返回值由 void 改为 ReleaseOutput（尚无实现，调用方可忽略返回值）。 */
  release(input: ReleaseInput): Promise<ReleaseOutput>;
}

/**
 * 3.25（G1-7 好感度权益卡死）：这位用户是否付过费——充值过积分（管理员代充值，不含注册赠送与开通会员赠送）或开通过 PRO+。
 * 提供方 billing；调用方 growth（从未付费且当前不是 PRO+ 的账号，好感度最高停在「亲密好友」）。单独成接口，不影响已有实现。
 */
export interface BillingPaidHistoryPort {
  hasPaidBefore(userId: string, tx?: Tx): Promise<boolean>;
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
  /** 3.16：原流水有符号余额变动；扣款负、冲正正。新对账不得对冲正取绝对值。 */
  signedAmountMicros?: number;
  /** 平台成功调用的零金额成本校正，不是第二笔售价扣费。 */
  costCorrection?: boolean;
  /** 3.16：关联冻结，旧实现可能不提供。 */
  holdId?: string | null;
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

/** 3.16：即使未产生扣费流水，也可读取权威关闭快照；不改账、不清待核风险。 */
export interface UsageBillingState {
  holdId: string;
  accountKind: 'user' | 'platform';
  usageRecordId: string | null;
  status: 'active' | 'expired' | 'released' | 'settled';
  settlement: SettleOutput | null;
  release: ReleaseOutput | null;
  expiresAt?: string;
  risk?: CallRiskSnapshot | null;
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
  /** 3.16提供方必须接入；可选仅兼容旧组合根，缺失时新对账明确不可用。最多1000个ID。 */
  getBillingStatesByHoldIds?(holdIds: readonly string[]): Promise<UsageBillingState[]>;
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

// ---------- 3.3（积分制与模型倍率，ADR-0032） ----------

/** 3.3：一个模型的 token 单价（微元 / 百万 token）。没有单独缓存价时 cachedInput 为 null（按输入价计）。 */
export interface ModelTokenPrices {
  inputPerMillionMicros: number;
  cachedInputPerMillionMicros: number | null;
  outputPerMillionMicros: number;
  /** 3.24：缓存写入（5 分钟 / 1 小时）全天价；null / 不带 = 没有单独价格（按输入价计）。 */
  cacheWrite5mPerMillionMicros?: number | null;
  cacheWrite1hPerMillionMicros?: number | null;
}

/** 3.3：当前生效价目表里一个模型的 token 价格（全天价；有分时价时 hasTimeBands = true）。 */
export interface ActiveModelTokenRates {
  price: ModelTokenPrices;
  cost: ModelTokenPrices;
  hasTimeBands: boolean;
}

/**
 * 3.3：模型倍率端口。提供方 billing；调用方**只有 model-access**（后台「模型」页一次保存目录与倍率；
 * 模型列表推算价格档位、约每条积分）。价目表仍归 billing（版本、冻结引用价目表版本都不变）。
 */
export interface BillingModelRatePort {
  /** 当前生效价目表里这些模型的 token 全天价；没有价格的模型不在结果里。 */
  getActiveTokenRates(modelKeys: readonly string[]): Promise<Map<string, ActiveModelTokenRates>>;
  /**
   * 复制当前生效价目表，把该模型的输入 / 缓存 / 输出三项价格（含它们的分时价）替换为给定的全天价，
   * 生成新版本并立即发布（同一事务，写审计）。价格与当前完全相同时不发新版本，返回当前版本 ID。
   */
  publishModelTokenRates(input: {
    operatorUserId: string;
    modelKey: string;
    price: ModelTokenPrices;
    cost: ModelTokenPrices;
  }): Promise<{ priceVersionId: string; published: boolean }>;
  /**
   * 3.22：各模型的限时折扣设置（含未开始 / 已结束的；没有设置的模型不在结果里）。
   * 折扣只作用于售价，成本不变；冻结、结算、报价都由 billing 在同一处按折扣计算（冻结时锁定折扣）。
   */
  getModelDiscounts(modelKeys: readonly string[]): Promise<Map<string, ModelDiscountSetting>>;
  /** 3.22：设置 / 取消（discount = null）某模型的限时折扣（写审计）。 */
  setModelDiscount(input: {
    operatorUserId: string;
    modelKey: string;
    discount: ModelDiscountSetting | null;
  }): Promise<void>;
  /**
   * 3.23：删除模型时调用。复制当前生效价目表、去掉这些模型的全部价格行（token、语音、图片等所有单位），
   * 生成新版本并立即发布（历史版本保留，写审计）；同时删除它们的限时折扣。
   * 当前价目表里没有它们的价格时不发新版本，priceVersionId 为 null。
   */
  removeModels(input: {
    operatorUserId: string;
    modelKeys: readonly string[];
  }): Promise<{ priceVersionId: string | null; pricedModels: number; discounts: number }>;
  /** 3.23：删除预览用——当前生效价目表里有价格的模型键、有折扣设置的模型键（只读）。 */
  modelPriceFootprint(
    modelKeys: readonly string[],
  ): Promise<{ pricedModelKeys: string[]; discountedModelKeys: string[] }>;
}

/** 3.22：限时折扣。rate 0.01～0.99；[startsAt, endsAt) 生效（ISO 时间）。 */
export interface ModelDiscountSetting {
  rate: number;
  startsAt: string;
  endsAt: string;
}

// ---------- 3.1（积压 ㉖ 计费报价、㉞ 当日聊天花费） ----------

/**
 * 3.1：按价目表报价（不冻结、不记账）。提供方：billing；调用方：**只有 model-access**（R9 同 BillingReservationPort 的理由：
 * 价目表只经网关解释）。其他模块要估价用 `ModelQuotePort`（model-gateway.ts），由网关先解析用户所选模型再来这里报价。
 * 当前价目表没有该模型价格时返回 null。
 */
export interface BillingQuotePort {
  quote(
    modelKey: string,
    estimate: UsageQuantities,
  ): Promise<{ amountMicros: number; priceVersionId: string } | null>;
}

/**
 * 3.1：用户某一天按用途统计的已结算金额（不含已冻结未结算、已退款部分）。提供方：billing；任何模块可读（只读、只有金额）。
 * 用途：行为规划成本闸「规划费用不超过当天聊天回复费用的 10%」（ai-runtime，docs/ai/behavior-planning.md 4.3 节）。
 * localDate 按用户时区（调用方算好）；没有记录的用途不出现在结果里。
 */
export interface BillingDailySpendReadPort {
  getUserDailySpendByPurpose(
    userId: string,
    localDate: string,
  ): Promise<Partial<Record<ModelPurpose, number>>>;
}

// ---------- 3.8（总经理 10-14 总对照表 Q5：申请制作扣积分） ----------

/** 3.8：固定价格的服务费用途。新增取值是次版本变更。 */
export type ServiceFeeKind = 'role_request';

export interface ServiceFeeHoldInput {
  userId: string;
  kind: ServiceFeeKind;
  /** 冻结金额（正整数微元；积分 × MICROS_PER_POINT）。 */
  amountMicros: number;
  /** 幂等键：同一个键重复冻结返回同一个冻结（不同金额抛异常）。建议 `{kind}:{userId}:{clientRequestId}`。 */
  idempotencyKey: string;
  /** 用户可见的说明，写到扣费流水的 note（例「申请制作：某角色」），最多 100 字。 */
  note: string;
}

export interface ServiceFeeHold {
  holdId: string;
  amountMicros: number;
  /** active = 冻结中；settled = 已扣除；released = 已退回。 */
  status: 'active' | 'settled' | 'released';
}

/**
 * 3.8：服务费端口（固定金额的冻结 / 扣除 / 退回）。提供方：billing；调用方：plaza（申请制作）。
 * 与 BillingReservationPort（按模型价目表、有过期时间、只给网关）分开：服务费按固定积分价，冻结**不过期**，
 * 直到调用方扣除或退回。冻结计入账户 held（可用余额相应减少）；扣除时写一条 charge 流水（purpose = service_fee，
 * 用户端分类 service），退回不写流水。三个方法都幂等。
 */
export interface BillingServiceFeePort {
  /** 冻结。可用余额不足返回 insufficient_balance（不透支、不记 insufficient_since）。 */
  hold(
    input: ServiceFeeHoldInput,
    tx?: Tx,
  ): Promise<PortResult<ServiceFeeHold, 'insufficient_balance'>>;
  /** 扣除（active → settled）；已扣除再调返回同一结果；已退回的抛异常。 */
  settle(holdId: string): Promise<{ ledgerEntryId: string; amountMicros: number }>;
  /** 退回（active → released）；已退回再调什么都不做；已扣除的抛异常。 */
  release(holdId: string, tx?: Tx): Promise<void>;
  /** 3.15：只返回指定用户本人键的冻结；仅用于旧孤儿兼容，不改变hold幂等含义。 */
  getByKey(userId: string, idempotencyKey: string, tx?: Tx): Promise<ServiceFeeHold | null>;
  /** 查冻结状态；不存在返回 null。 */
  get(holdId: string): Promise<ServiceFeeHold | null>;
}
