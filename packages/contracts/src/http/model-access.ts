/**
 * model-access 模块：模型目录、用户的模型选择、模型可用状态；管理后台的上游（平台密钥）与模型目录维护。
 * 需求：MDL（PRD v1.2 计费章节）。设计见 docs/architecture/billing.md 第 3、9 节，决策 ADR-0012。
 *
 * v0.2（T-009）：BYOK 全部删除。用户不再填写密钥，只选择平台模型目录里的模型（modelKey）。
 * 安全规则：任何响应都不包含上游密钥原文或密文，只有前 4 后 4 位掩码（docs/architecture/security-and-privacy.md 第 3 节）。
 * 价格不在本文件：见 http/billing.ts（价目表归 billing 模块）。模型清单、标签、排行榜数据由 AI 负责人维护（docs/ai/model-catalog.md）。
 * v1.1（T-020）：默认识图模型（defaultFor 新增 vision）；管理后台用量与费用查询（ADM-08，billing.md 10.1 节）。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';
import { BillingOwner, ModelPurpose } from '../ports/model-gateway.js';

// ---------- 模型目录 ----------

/** 平台内的模型键，例 "deepseek/deepseek-v4-pro"。用户选择、价目表、用量都用它。 */
export const ModelKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,47}\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/);
export type ModelKey = z.infer<typeof ModelKey>;

/**
 * 模型能力。adult_content = 无审查 / 允许成人内容的模型：只能用于有成人资格的角色
 * （hard-boundaries.md 第 4 节「模型层闸门」、billing.md 第 9 节）。
 * 对用户它只是「允许成人内容」信息标签，不是选为成人模式模型的前提（pm-rulings-2 B1）。
 * 新增能力是次版本变更：客户端解析 ModelInfo 时不认识的能力变为 'unsupported'，不显示即可。
 */
export const ModelCapability = z.enum([
  'vision',
  'voice_input',
  'voice_output',
  'web_search',
  'image_generation',
  'adult_content',
]);
export type ModelCapability = z.infer<typeof ModelCapability>;

export const PriceTier = z.enum(['cheap', 'medium', 'expensive']);

export const ModelInfo = z.object({
  modelKey: ModelKey,
  displayName: z.string(),
  /** 模型出品方展示名，例「深度求索」。用户看不到上游（走哪个接口）。 */
  vendorName: z.string(),
  /** 价格档位，由价目表推算，用于列表上的「便宜 / 中等 / 较贵」标签；具体价格见 billing 价目表。 */
  priceTier: PriceTier,
  capabilities: z.array(tolerantEnum(ModelCapability)),
  /** 展示标签，例：「中文好」「长记忆」「后台推荐」，由 AI 负责人维护。 */
  tags: z.array(z.string()),
  leaderboardRank: z.number().int().positive().nullable(),
  /** 当前是否可用（上游故障时为 false，下架的模型不出现在列表中）。 */
  available: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

// ---------- 用户的模型选择 ----------

export const ModelRef = z.object({ modelKey: ModelKey });
export type ModelRef = z.infer<typeof ModelRef>;

export const ModelRefState = ModelRef.extend({
  /** 该选择当前是否可用。 */
  available: z.boolean(),
  unavailableReason: z.enum(['model_removed', 'provider_unavailable']).nullable(),
});

/** 模型的三种用途（术语见 glossary：聊天模型、后台模型、成人模式模型）。 */
export const ModelRole = z.enum(['chat', 'background', 'adult']);
export type ModelRole = z.infer<typeof ModelRole>;

export const ModelSelection = z.object({
  /** 未设置时使用平台默认聊天模型（管理员在模型目录中标记）。 */
  chat: ModelRefState.nullable(),
  /** 不设置时后台功能沿用聊天模型。 */
  background: ModelRefState.nullable(),
  /**
   * 成人模式模型。不设置时成人模式**不能开启**（422 adult_model_missing，提示去「服务 → 模型」选择），
   * 不会自动改用聊天模型（pm-rulings-2 B2）。
   */
  adult: ModelRefState.nullable(),
});
export type ModelSelection = z.infer<typeof ModelSelection>;

/**
 * 修改全局模型选择。chat / background 不能选 adult_content 模型（422 model_not_allowed），
 * 因为全局选择会作用到真人和儿童角色。
 * adult（成人模式模型）可以选目录里任何模型：adult_content 只是信息标签，列表把带标签的排在前面，
 * 但不限制只能选它（pm-rulings-2 B1、PRD MDL-02 第 3 条）。真正的闸门是「无审查模型只能给有成人资格的角色用」
 * （网关调用时 checkModelForCharacter）和「开启成人模式前必须已设置成人模式模型」（adult_model_missing）。
 */
export const UpdateModelSelectionRequest = z.object({
  chat: ModelRef.nullable().optional(),
  background: ModelRef.nullable().optional(),
  adult: ModelRef.nullable().optional(),
});

export const CharacterModelOverride = z.object({
  characterId: Id,
  chat: ModelRefState.nullable(),
});

/** 某个角色当前能否回复，用于私聊顶部系统横条。 */
export const ModelStatus = z.object({
  characterId: Id.nullable(),
  available: z.boolean(),
  reason: z
    .enum([
      'not_configured', // 没有可用的模型（平台默认也未配置）
      'insufficient_balance', // 余额不足（billing 判定）
      'provider_unavailable', // 模型暂时不可用
      'model_removed', // 所选模型已下架
    ])
    .nullable(),
  /** 角色单独设置的模型不可用、全局模型正常时为 true，界面显示「临时改用默认模型」按钮。 */
  canFallbackToDefault: z.boolean(),
});
export type ModelStatus = z.infer<typeof ModelStatus>;

export const ModelAccessEndpoints = {
  listModels: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/models`,
    auth: 'user',
    query: z.object({ capability: ModelCapability.optional() }),
    response: z.object({ items: z.array(ModelInfo) }),
    summary: '模型目录（带价格档位、能力、标签、排行名次）；具体价格调 GET /billing/prices',
  }),
  getSelection: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/selection`,
    auth: 'user',
    response: ModelSelection,
    summary: '全局模型选择',
  }),
  updateSelection: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/model/selection`,
    auth: 'user',
    body: UpdateModelSelectionRequest,
    response: ModelSelection,
    summary:
      '修改全局模型选择。chat / background 选无审查（adult_content）模型 → 422 model_not_allowed；adult 不限模型（adult_content 只是信息标签）',
  }),
  getCharacterOverride: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/character-overrides/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: CharacterModelOverride,
    summary: '某角色单独设置的聊天模型',
  }),
  setCharacterOverride: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/model/character-overrides/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: z.object({ chat: ModelRef.nullable() }),
    response: CharacterModelOverride,
    summary:
      '为角色单独设置聊天模型；null 恢复使用全局默认。无审查模型只能给有成人资格的角色设置，否则 403 model_not_allowed',
  }),
  getModelStatus: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/status`,
    auth: 'user',
    query: z.object({ characterId: Id.optional() }),
    response: ModelStatus,
    summary: '模型可用状态，用于系统横条（含余额不足）',
  }),
} as const;

// ---------- 管理后台：上游（平台密钥） ----------

export const UpstreamStatus = z.enum([
  'active',
  'invalid', // 密钥无效 / 被作废
  'quota_exhausted', // 平台在该上游的余额用完（需要总经理去供应商处充值）
  'unavailable', // 重试后仍失败
]);
export type UpstreamStatus = z.infer<typeof UpstreamStatus>;

/** v1 只有 OpenAI 兼容接入；个别非兼容的语音 / 图片接口由 AI 负责人在适配器中处理并以新取值加入。 */
export const UpstreamKind = z.enum(['openai_compatible']);

export const Upstream = z.object({
  upstreamId: Id,
  /** 展示名，例「DeepSeek 官方」「阿里云百炼」「OpenRouter」。 */
  name: z.string().min(1).max(40),
  kind: UpstreamKind,
  baseUrl: z.url(),
  /** 掩码，例 "sk-a…9xQz"。 */
  maskedKey: z.string().max(16),
  status: UpstreamStatus,
  statusChangedAt: Timestamp,
  createdAt: Timestamp,
});
export type Upstream = z.infer<typeof Upstream>;

export const CreateUpstreamRequest = z.object({
  name: z.string().min(1).max(40),
  kind: UpstreamKind,
  baseUrl: z.url(),
  /** 密钥原文，只在此请求和 rotateKey 请求中出现。服务器去除首尾空白后先做连通测试。 */
  apiKey: z.string().min(8).max(512),
});

export const UpstreamTestFailure = z.enum([
  'invalid_key',
  'insufficient_balance',
  'network_error',
  'provider_error',
]);

/** 连通测试失败时 422 upstream_test_failed 的 details 结构。 */
export const UpstreamTestFailedDetails = z.object({ reason: UpstreamTestFailure });

// ---------- 管理后台：模型目录 ----------

export const AdminCatalogEntry = z.object({
  modelKey: ModelKey,
  displayName: z.string().min(1).max(60),
  vendorName: z.string().min(1).max(40),
  upstreamId: Id,
  /** 上游那边的模型名。 */
  upstreamModelId: z.string().min(1).max(128),
  capabilities: z.array(ModelCapability),
  tags: z.array(z.string().max(16)).max(10),
  leaderboardRank: z.number().int().positive().nullable(),
  sortOrder: z.number().int(),
  /**
   * 作为平台默认模型（每种最多一个）；无审查模型不能设为默认。
   * v1.1：vision = 平台默认识图模型（pm-rulings-2 B5、PRD ADM-05 第 9 条）：用途为 vision 时，
   * 若用户（或角色覆盖）解析出的聊天模型没有 vision 能力，网关改用它，费用照常从用户余额扣；
   * 必须具备 vision 能力；未设置时网关返回 capability_missing（billing.md 3.2 节）。
   */
  defaultFor: z.array(z.enum(['chat', 'background', 'vision'])),
  enabled: z.boolean(),
  updatedAt: Timestamp,
});
export type AdminCatalogEntry = z.infer<typeof AdminCatalogEntry>;

export const AdminCatalogEntryWrite = AdminCatalogEntry.omit({ updatedAt: true });

export const ModelAccessAdminEndpoints = {
  listUpstreams: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/upstreams`,
    auth: 'admin',
    response: z.object({ items: z.array(Upstream) }),
    summary: '上游列表（只有掩码）',
  }),
  createUpstream: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/upstreams`,
    auth: 'admin',
    body: CreateUpstreamRequest,
    response: Upstream,
    summary:
      '登记上游：先连通测试（记平台账户），成功才保存。失败 422 upstream_test_failed（details.reason）',
  }),
  rotateUpstreamKey: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/upstreams/:upstreamId/key`,
    auth: 'admin',
    params: z.object({ upstreamId: Id }),
    body: z.object({ apiKey: z.string().min(8).max(512) }),
    response: Upstream,
    summary: '更换上游密钥（先测试再替换）',
  }),
  testUpstream: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/upstreams/:upstreamId/test`,
    auth: 'admin',
    params: z.object({ upstreamId: Id }),
    response: Upstream,
    summary: '手动连通测试，刷新状态',
  }),
  deleteUpstream: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/admin/model/upstreams/:upstreamId`,
    auth: 'admin',
    params: z.object({ upstreamId: Id }),
    response: NoContent,
    summary: '删除上游；仍有启用的模型指向它时 409 conflict',
  }),
  listCatalog: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/catalog`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminCatalogEntry) }),
    summary: '模型目录（含停用的）',
  }),
  upsertCatalogEntry: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/catalog/:modelKey`,
    auth: 'admin',
    params: z.object({ modelKey: z.string() }),
    body: AdminCatalogEntryWrite,
    response: AdminCatalogEntry,
    summary:
      '新增或修改模型目录条目；改指上游、停用都记审计日志。path 中的 modelKey 需 URL 编码。v1.3：保存为启用（enabled = true）时，当前生效价目表没有该模型的价格 → 422 model_unavailable（BillingChargeQueryPort.listActivePricedModelKeys，billing.md 4.1 节）',
  }),
} as const;

// ---------- 管理后台：用量与费用（ADM-08，v1.1） ----------
// 设计见 docs/architecture/billing.md 10.1 节。数据来自 model_access.usage_records：每次调用一行，
// 结算时把 billing 返回的扣费、成本、平台吸收成本记在同一行（快照，权威仍是 billing 流水，对账第 ② 层校验）。
// 查询条件较多（多选列表），所以三个查询接口都用 POST + 请求体；它们只读，不创建任何数据。
// 任何响应都不含消息内容、提示词或模型输出。

/** 分组维度。day 按北京时间自然日（与供应商账单日一致，billing.md 第 7 节）。 */
export const AdminUsageDimension = z.enum([
  'user',
  'character',
  'model',
  'purpose',
  'upstream',
  'day',
]);
export type AdminUsageDimension = z.infer<typeof AdminUsageDimension>;

export const AdminUsageCallStatus = z.enum(['succeeded', 'failed']);

/** 筛选条件（可组合，均为「且」）。时间为左闭右开区间 [from, to)，界面按北京时间换算，可精确到小时。 */
export const AdminUsageFilter = z.object({
  from: Timestamp,
  to: Timestamp,
  userIds: z.array(Id).min(1).max(50).optional(),
  characterIds: z.array(Id).min(1).max(50).optional(),
  modelKeys: z.array(ModelKey).min(1).max(50).optional(),
  purposes: z.array(ModelPurpose).min(1).optional(),
  billingOwner: BillingOwner.optional(),
  status: AdminUsageCallStatus.optional(),
  upstreamIds: z.array(Id).min(1).max(50).optional(),
});
export type AdminUsageFilter = z.infer<typeof AdminUsageFilter>;

/** 一组调用的合计。金额为微元：charged = 用户被扣（售价），cost = 平台成本（成本价），absorbedCost = 失败调用由平台吸收的成本。 */
export const AdminUsageTotals = z.object({
  calls: z.number().int().nonnegative(),
  failedCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  /** 其中按估算得出的 token 数（上游没返回用量时），界面据此显示估算占比。 */
  estimatedTokens: z.number().int().nonnegative(),
  chargedMicros: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  absorbedCostMicros: z.number().int().nonnegative(),
});
export type AdminUsageTotals = z.infer<typeof AdminUsageTotals>;

export const AdminUsageSummaryRequest = z.object({
  filter: AdminUsageFilter,
  /** 1～2 个分组维度，不能重复。 */
  groupBy: z
    .array(AdminUsageDimension)
    .min(1)
    .max(2)
    .refine((dims) => new Set(dims).size === dims.length, { message: '分组维度不能重复' }),
  /** key_asc：按分组键排序（趋势图用 day）；charged_desc：按用户扣费从高到低（「前 10 名」用）。 */
  sort: z.enum(['key_asc', 'charged_desc']).default('key_asc'),
  limit: z.number().int().min(1).max(1000).default(200),
});

export const AdminUsageSummaryRow = AdminUsageTotals.extend({
  /** 与 groupBy 一一对应的键：userId / characterId（无角色为空字符串）/ modelKey / 用途 / upstreamId / 日期。 */
  keys: z.array(z.string()).min(1).max(2),
});

export const AdminUsageSummary = z.object({
  rows: z.array(AdminUsageSummaryRow),
  /** 整个筛选范围的合计（不受 limit 影响）。 */
  totals: AdminUsageTotals,
  /** 分组行数超过 limit 被截断。 */
  truncated: z.boolean(),
});
export type AdminUsageSummary = z.infer<typeof AdminUsageSummary>;

/** 一次调用的明细（ADM-08 第 5 条）。没有任何内容字段。 */
export const AdminUsageRecord = z.object({
  usageRecordId: Id,
  createdAt: Timestamp,
  /** 发起调用的用户；平台账户的调用为发起操作的管理员。 */
  userId: Id,
  characterId: Id.nullable(),
  conversationKind: z.enum(['direct', 'group']).nullable(),
  /** 不认识的用途解析为 'unsupported'。 */
  purpose: tolerantEnum(ModelPurpose),
  billingOwner: BillingOwner,
  modelKey: ModelKey,
  upstreamId: Id,
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  estimated: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  /** 首字耗时；非流式调用为 null。 */
  ttftMs: z.number().int().nonnegative().nullable(),
  status: AdminUsageCallStatus,
  /** 失败时的错误类别（网关内部错误码，不含上游原文）。 */
  errorCode: z.string().max(64).nullable(),
  retryCount: z.number().int().nonnegative(),
  chargedMicros: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  absorbedCostMicros: z.number().int().nonnegative(),
  priceVersionId: Id.nullable(),
  /** 这次扣费动用了安全优先透支（billing.md 6.6 节）。 */
  safetyOverdraft: z.boolean(),
});
export type AdminUsageRecord = z.infer<typeof AdminUsageRecord>;

/** 导出上限：一次最多导出的明细行数，超过时 truncated = true，请缩小筛选范围。 */
export const ADMIN_USAGE_EXPORT_MAX_ROWS = 50_000 as const;

export const ModelAccessAdminUsageEndpoints = {
  usageSummary: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/summary`,
    auth: 'admin',
    body: AdminUsageSummaryRequest,
    response: AdminUsageSummary,
    summary: '用量与费用汇总：按 1～2 个维度分组，筛选条件可组合（只读查询）',
  }),
  listUsageRecords: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/records`,
    auth: 'admin',
    body: z.object({
      filter: AdminUsageFilter,
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    response: cursorPage(AdminUsageRecord),
    summary: '逐次调用明细（按时间倒序，只读查询），不含任何内容',
  }),
  exportUsageRecords: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/export`,
    auth: 'admin',
    body: z.object({ filter: AdminUsageFilter }),
    response: z.object({ items: z.array(AdminUsageRecord), truncated: z.boolean() }),
    summary:
      '导出明细（最多 ADMIN_USAGE_EXPORT_MAX_ROWS 行，管理后台转成 CSV）；每次导出写审计日志（ADM-08 第 6 条）',
  }),
} as const;
