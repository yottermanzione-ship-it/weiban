/**
 * model-access 模块：模型目录、用户的模型选择、模型可用状态；管理后台的上游（平台密钥）与模型目录维护。
 * 需求：MDL（PRD v1.2 计费章节）。设计见 docs/architecture/billing.md 第 3、9 节，决策 ADR-0012。
 *
 * v0.2（T-009）：BYOK 全部删除。用户不再填写密钥，只选择平台模型目录里的模型（modelKey）。
 * 安全规则：任何响应都不包含上游密钥原文或密文，只有前 4 后 4 位掩码（docs/architecture/security-and-privacy.md 第 3 节）。
 * 价格不在本文件：见 http/billing.ts（价目表归 billing 模块）。模型清单、标签、排行榜数据由 AI 负责人维护（docs/ai/model-catalog.md）。
 * v1.1（T-020）：默认识图模型（defaultFor 新增 vision）；管理后台用量与费用查询（ADM-08，billing.md 10.1 节）。
 * v3.3（2026-10-13，ADR-0032）：后台「模型」页用**倍率**表达价格（输入 / 输出 / 缓存三个倍率，数值 = 每百万 token
 * 的人民币价格）。新增合并接口 listModels / upsertModel（目录 + 倍率一次保存，后端自动生成并发布新价目表版本），
 * 取代分别维护「模型目录」和「价目表」；旧的 catalog / price-versions 接口保留给高级操作。ModelInfo 新增「约每条积分」。
 * v3.4（2026-10-13，ADR-0032 第二批）：上游账号池——一行上游 = 一个上游账号（同一服务商可多个），新增服务商、
 * 优先级、权重、并发 / 每分钟请求上限、启用、冷却与健康字段；模型路由（一个模型 → 多个账号）；修改账号、批量操作、
 * 拉取账号可用模型；每用户并发 / 频率上限与健康参数；用量看板（平均延迟、失败率、缓存命中率、积分、按小时、概览）。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  LocalDate,
  NoContent,
  Timestamp,
  cursorPage,
  defineEndpoint,
  tolerantEnum,
} from '../common.js';
import { BillingOwner, ModelPurpose } from '../ports/model-gateway.js';

// ---------- 模型目录 ----------
export const ModelLeaderboardSource = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.url({
    protocol: /^https$/,
    hostname: /^(www\.)?(arena|lmarena)\.ai$/,
    error: '来源须为Arena官方HTTPS链接',
  }),
  asOf: LocalDate.nullable(),
});
export const ModelLeaderboardInfo = z.object({
  source: ModelLeaderboardSource.nullable(),
  popular: z.array(z.object({ modelKey: z.string(), users: z.number().int().nonnegative() })),
});

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
  /**
   * v3.3：约每条回复消耗多少积分（按 cost-estimate.md 7.2「标准回复」用量和当前售价估算，1 元 = 100 积分）。
   * 用户端价目表只显示这个数；当前价目表没有该模型的 token 价格时为 null。
   */
  pointsPerReply: z.number().nonnegative().nullable().optional(),
  /**
   * 3.17（会员 v5，16 号 §2）：pointsPerReply 的来源。recent_7d = 最近 7 天该模型聊天回复的平均实扣；
   * default = 数据不足，按默认假设（发给模型约 1 万 token、八成命中缓存、回复约 200 token）和当前售价估算。
   */
  pointsPerReplyBasis: z.enum(['recent_7d', 'default']).optional(),
  /**
   * 3.17：积分消耗倍率（只展示，例 1.0 显示「×1.0」；扣费按实际 token × 售价，不按倍率）。
   * 后台手填优先；否则 = (0.8×输入售价 + 0.2×输出售价) / 基准模型同算式。算不出时为 null。
   */
  displayMultiplier: z.number().nonnegative().nullable().optional(),
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
export const ModelRole = z.enum(['chat', 'background', 'adult', 'adult_check']);
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
  /**
   * 3.1（积压 ㉚）：识图能否使用（截图导入、发图给角色看）= 解析出的聊天模型有 vision 能力，
   * 或平台设置了默认识图模型（defaultFor = vision）。客户端据此提前禁用截图导入入口；旧服务器不带时按 true（失败时再提示）。
   */
  visionAvailable: z.boolean().optional(),
});
export type ModelStatus = z.infer<typeof ModelStatus>;

export const ModelAccessEndpoints = {
  getLeaderboardInfo: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/leaderboard-info`,
    auth: 'user',
    response: ModelLeaderboardInfo,
    summary: '3.14：管理员榜单来源与当前全局聊天模型选择人数（非调用量）',
  }),
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
/** 3.0：dashscope = 阿里云百炼原生接口（语音、图片）；bocha_search = 博查搜索；jev = TypeSafe AI Jev（CR-18，待配置后验证）。 */
export const UpstreamKind = z.enum(['openai_compatible', 'dashscope', 'bocha_search', 'jev']);

/** v3.4：上游账号的调度参数（可空 = 不限）。 */
const UpstreamLimitFields = {
  /** 服务商标识（后台下拉：xiaomi_mimo / dashscope / deepseek / moonshot / zhipu / openrouter / openai_compatible…），只用于分组展示。 */
  provider: z.string().min(1).max(40),
  /** 优先级：数字小的先用；同一模型多个账号时先在最小优先级的一组里按权重分流。 */
  priority: z.number().int().min(0).max(1000),
  /** 权重（同优先级内按比例分流），1～1000。 */
  weight: z.number().int().min(1).max(1000),
  /** 同时进行中的调用上限；null = 不限。 */
  maxConcurrency: z.number().int().min(1).max(10_000).nullable(),
  /** 每分钟请求上限；null = 不限。 */
  rpmLimit: z.number().int().min(1).max(100_000).nullable(),
  /** 停用后不再分配调用（进行中的调用不受影响）。 */
  enabled: z.boolean(),
  note: z.string().max(200).nullable(),
};

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
  // ---- v3.4 上游账号池（旧服务器不带，客户端按默认值处理）----
  provider: UpstreamLimitFields.provider.optional(),
  priority: UpstreamLimitFields.priority.optional(),
  weight: UpstreamLimitFields.weight.optional(),
  maxConcurrency: UpstreamLimitFields.maxConcurrency.optional(),
  rpmLimit: UpstreamLimitFields.rpmLimit.optional(),
  enabled: z.boolean().optional(),
  note: UpstreamLimitFields.note.optional(),
  /** 连续失败后自动暂停到这个时间（期间不分配调用）；null = 没有暂停。 */
  cooldownUntil: Timestamp.nullable().optional(),
  consecutiveFailures: z.number().int().nonnegative().optional(),
  /** 最近一次失败的类别（网关内部错误码，不含上游原文），例 rate_limited / quota_exhausted / invalid_key。 */
  lastError: z.string().max(64).nullable().optional(),
  lastUsedAt: Timestamp.nullable().optional(),
  lastTestedAt: Timestamp.nullable().optional(),
  /** 当前进行中的调用数（本进程内存计数）。 */
  inFlight: z.number().int().nonnegative().optional(),
  /** 今天（北京时间）的调用次数与上游成本（微元）。 */
  todayCalls: z.number().int().nonnegative().optional(),
  todayCostMicros: z.number().int().nonnegative().optional(),
  /**
   * 3.20：删除时间（软删）。非空 = 已删除：密钥已清空、不参与调度、不能再被模型指向；
   * 列表仍返回它，只为让历史调用记录能显示账号名，后台的账号列表与线路选择应隐藏它。
   */
  deletedAt: Timestamp.nullable().optional(),
});
export type Upstream = z.infer<typeof Upstream>;

export const CreateUpstreamRequest = z.object({
  name: z.string().min(1).max(40),
  kind: UpstreamKind,
  baseUrl: z.url(),
  /** 密钥原文，只在此请求和 rotateKey 请求中出现。服务器去除首尾空白后先做连通测试。 */
  apiKey: z.string().min(8).max(512),
  // ---- v3.4（可省，省略时：provider = kind、priority 1、weight 100、不限并发 / 频率、启用）----
  provider: UpstreamLimitFields.provider.optional(),
  priority: UpstreamLimitFields.priority.optional(),
  weight: UpstreamLimitFields.weight.optional(),
  maxConcurrency: UpstreamLimitFields.maxConcurrency.optional(),
  rpmLimit: UpstreamLimitFields.rpmLimit.optional(),
  enabled: z.boolean().optional(),
  note: UpstreamLimitFields.note.optional(),
  /**
   * v3.4：连通测试失败也保存（状态按失败原因记为异常，06-old-ui-spec 9.4「测试不通过也允许保存」）。
   * 不传 / false 时保持原规则：测试失败 422 upstream_test_failed，不保存。
   */
  saveOnTestFailure: z.boolean().optional(),
});

/** v3.4：修改上游账号（不含密钥；换密钥用 rotateUpstreamKey）。只改传了的字段。 */
export const UpdateUpstreamRequest = z.object({
  name: z.string().min(1).max(40).optional(),
  baseUrl: z.url().optional(),
  provider: UpstreamLimitFields.provider.optional(),
  priority: UpstreamLimitFields.priority.optional(),
  weight: UpstreamLimitFields.weight.optional(),
  maxConcurrency: UpstreamLimitFields.maxConcurrency.optional(),
  rpmLimit: UpstreamLimitFields.rpmLimit.optional(),
  enabled: z.boolean().optional(),
  note: UpstreamLimitFields.note.optional(),
});

/** v3.4：批量操作上游账号。 */
export const UpstreamBatchRequest = z.object({
  upstreamIds: z.array(Id).min(1).max(100),
  action: z.enum(['test', 'enable', 'disable']),
});

/** v3.4：从上游账号拉取到的可用模型（OpenAI 兼容 GET {baseUrl}/models 的 id 列表）。 */
export const UpstreamModelList = z.object({
  items: z.array(z.object({ id: z.string().max(200) })),
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

/**
 * v3.6：系统消息放法（docs/refactor/09-chat-pipeline.md 第 5 节）。不同平台对「多条 / 中间插入的系统消息」支持不一：
 * - multi：原样发送（默认）；
 * - single_system：只保留第一条系统消息，其余系统消息改成用户消息（开头注明「系统提示，不是用户说的话」），相邻同角色合并；
 * - no_system：连第一条也改成用户消息（个别不认 system 角色的模型）。
 * 上架新模型时用评测集验证该选哪种。
 */
export const SystemMessageMode = z.enum(['multi', 'single_system', 'no_system']);
export type SystemMessageMode = z.infer<typeof SystemMessageMode>;

/** 3.16：管理员依据供应商规格核准，绑定到具体路由；缺失即调用前拒绝，不猜模型上限。 */
export const RouteBillingBounds = z
  .object({
    format: z.literal('billing-bounds-v1'),
    pauseReason: z.literal('usage_unknown').optional(),
    sourceUrl: z.url({ protocol: /^https$/ }).max(2048),
    checkedAt: Timestamp,
    text: z
      .object({
        contextTokens: z.number().int().min(1).max(10000000),
        maxOutputTokens: z.number().int().min(1).max(32000),
        totalOutputIncludesReasoning: z.literal(true),
        outputParameter: z.enum(['max_tokens', 'max_completion_tokens']),
        maxImages: z.number().int().min(0).max(20),
      })
      .optional(),
    tts: z
      .object({
        maxTextBytes: z.number().int().min(1).max(100000),
        counting: z.enum(['codepoints', 'utf16', 'utf8_bytes']),
      })
      .optional(),
    asr: z
      .object({
        maxSeconds: z.number().int().min(1).max(86400),
        billingStepSeconds: z.number().int().min(1).max(3600),
      })
      .optional(),
    image: z
      .object({
        sizes: z.array(z.enum(['1024x1024', '768x1024', '1024x768'])).min(1),
        quality: z.literal('standard'),
        count: z.literal(1),
      })
      .optional(),
    search: z
      .object({ maxResults: z.number().int().min(1).max(10), billableCalls: z.literal(1) })
      .optional(),
    decision: z.object({ maxInputTokens: z.number().int().min(1).max(10000000) }).optional(),
  })
  .strict();
export type RouteBillingBounds = z.infer<typeof RouteBillingBounds>;

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
   * 3.0：planner = 行为规划默认模型（CR-17，只能用于 behavior_planning）；speech_synthesis / speech_recognition /
   * image_generation / web_search = 平台提供的语音合成、语音识别、图片生成、联网搜索服务（MED，平台未设置即「未开通」）。
   */
  defaultFor: z.array(
    z.enum([
      'chat',
      'background',
      'vision',
      'planner',
      'adult_check',
      'speech_synthesis',
      'speech_recognition',
      'image_generation',
      'web_search',
    ]),
  ),
  enabled: z.boolean(),
  /** v3.6：系统消息放法；写入时不传 = 保持原值（新建默认 multi）。 */
  systemMessageMode: SystemMessageMode.optional(),
  billingBounds: RouteBillingBounds.nullable().optional(),
  updatedAt: Timestamp,
});
export type AdminCatalogEntry = z.infer<typeof AdminCatalogEntry>;

export const AdminCatalogEntryWrite = AdminCatalogEntry.omit({ updatedAt: true });

/**
 * v3.4：模型路由——这个模型可以走哪些上游账号（按优先级、权重调度，失败自动切换到下一个）。
 * 目录条目的 upstreamId / upstreamModelId 是「主路由」（优先级最小、权重最大的那条）的镜像，旧接口照常可用。
 */
export const ModelRoute = z.object({
  upstreamId: Id,
  /** 该账号那边的模型名（不同服务商同一模型可能叫法不同）。 */
  upstreamModelId: z.string().min(1).max(128),
  priority: z.number().int().min(0).max(1000),
  weight: z.number().int().min(1).max(1000),
  enabled: z.boolean(),
  billingBounds: RouteBillingBounds.nullable().optional(),
});
export type ModelRoute = z.infer<typeof ModelRoute>;

// ---------- 管理后台：模型（目录 + 倍率合并，v3.3） ----------

/**
 * v3.3：模型倍率（ADR-0032）。三个数值 = **每百万 token 的人民币价格（元）**，最多 4 位小数。
 * input = 未命中缓存的输入，output = 输出，cache = 命中缓存的输入。
 * 1 元 = 100 积分，所以用户每百万 token 消耗的积分 = 倍率 × 100。
 */
export const ModelRates = z.object({
  input: z.number().nonnegative().max(100_000),
  output: z.number().nonnegative().max(100_000),
  cache: z.number().nonnegative().max(100_000),
});
export type ModelRates = z.infer<typeof ModelRates>;

/** v3.3：后台「模型」页的一行 = 目录条目 + 当前生效价目表里的倍率。 */
export const AdminModel = AdminCatalogEntry.extend({
  /** 售价倍率（用户被扣的钱）；当前生效价目表里没有该模型的 token 价格时为 null（例：语音、图片模型）。 */
  rates: ModelRates.nullable(),
  /** 成本倍率（上游收平台的钱，对账用）；默认与售价相同（个人测试阶段加价系数 1.00）。 */
  costRates: ModelRates.nullable(),
  /** 当前价目表里这个模型有分时价（例 DeepSeek 夜间半价）：用倍率保存后会变成全天统一价。 */
  hasTimeBands: z.boolean(),
  /** 约每条回复消耗多少积分（cost-estimate.md 7.2「标准回复」），rates 为 null 时为 null。 */
  pointsPerReply: z.number().nonnegative().nullable(),
  /** v3.4：模型路由（按优先级升序）。 */
  routes: z.array(ModelRoute).optional(),
  /** 3.17：后台手填的展示倍率；null = 自动计算。 */
  displayMultiplierManual: z.number().nonnegative().nullable().optional(),
  /** 3.17：实际展示给用户的倍率（手填或自动），算不出为 null。 */
  displayMultiplier: z.number().nonnegative().nullable().optional(),
});
export type AdminModel = z.infer<typeof AdminModel>;

export const AdminModelWrite = AdminCatalogEntryWrite.extend({
  /**
   * 售价倍率。传 null = 不改价目表（语音、图片等非 token 计价的模型在「价目表版本」高级页维护）。
   * 与当前价格不同时，后端复制当前生效价目表、替换这个模型的输入 / 输出 / 缓存三项价格，生成新版本并立即发布。
   */
  rates: ModelRates.nullable(),
  /** 成本倍率；不传或 null = 与售价倍率相同。 */
  costRates: ModelRates.nullable().optional(),
  /**
   * v3.4：模型路由（整体替换，至少 1 条、账号不能重复）。不传 = 只保证 upstreamId / upstreamModelId 这条路由存在。
   * 传了时 upstreamId / upstreamModelId 以路由里的主路由为准（服务器自动同步）。
   */
  routes: z.array(ModelRoute).min(1).max(20).optional(),
  /** 3.17：展示倍率手填值（最多 2 位小数）；null = 改为自动计算；不传 = 不改。 */
  displayMultiplierManual: z.number().min(0).max(1000).nullable().optional(),
});

/** 3.17：展示倍率的基准模型（倍率 = 1.00 的那个）；null = 未设置，自动倍率不显示。 */
export const DisplayMultiplierSettings = z.object({ baseModelKey: ModelKey.nullable() });
export type DisplayMultiplierSettings = z.infer<typeof DisplayMultiplierSettings>;

/** v3.4：每用户限流与健康参数（后台「模型管理」设置）。 */
export const GatewayLimits = z.object({
  /** 每个用户同时进行中的模型调用上限；null = 不限。超出时这次调用按「模型暂时不可用」返回。 */
  perUserConcurrency: z.number().int().min(1).max(1000).nullable(),
  /** 每个用户每分钟模型调用上限；null = 不限。 */
  perUserRpm: z.number().int().min(1).max(100_000).nullable(),
  /** 账号连续失败多少次后自动暂停。 */
  failureThreshold: z.number().int().min(1).max(100),
  /** 自动暂停多少秒后再试。 */
  cooldownSeconds: z.number().int().min(10).max(86_400),
});
export type GatewayLimits = z.infer<typeof GatewayLimits>;

export const ModelAccessAdminEndpoints = {
  getDisplayMultiplierSettings: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/display-multiplier`,
    auth: 'admin',
    response: DisplayMultiplierSettings,
    summary: '3.17：展示倍率基准模型',
  }),
  updateDisplayMultiplierSettings: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/display-multiplier`,
    auth: 'admin',
    body: DisplayMultiplierSettings,
    response: DisplayMultiplierSettings,
    summary: '3.17：修改展示倍率基准模型（写审计）；只影响展示，不影响扣费',
  }),
  getLeaderboardSource: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/leaderboard-source`,
    auth: 'admin',
    response: ModelLeaderboardSource.nullable(),
    summary: '3.14：榜单来源配置',
  }),
  updateLeaderboardSource: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/leaderboard-source`,
    auth: 'admin',
    body: ModelLeaderboardSource,
    response: ModelLeaderboardSource,
    summary: '3.14：管理员维护Arena榜单来源/日期；模型名次沿原leaderboardRank',
  }),
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
    summary:
      '3.20：删除上游（软删，历史调用记录保留可读）；仍被任何模型线路引用（含停用的模型）时 409 conflict，error.details = { modelKeys, modelNames }',
  }),
  updateUpstream: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/admin/model/upstreams/:upstreamId`,
    auth: 'admin',
    params: z.object({ upstreamId: Id }),
    body: UpdateUpstreamRequest,
    response: Upstream,
    summary:
      'v3.4：修改上游账号（名称、地址、服务商、优先级、权重、并发 / 频率上限、启用、备注）；改地址会清空冷却并按「需要重新测试」处理；写审计',
  }),
  batchUpstreams: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/upstreams/batch`,
    auth: 'admin',
    body: UpstreamBatchRequest,
    response: z.object({ items: z.array(Upstream) }),
    summary: 'v3.4：批量测试 / 启用 / 停用上游账号，返回操作后的账号',
  }),
  listUpstreamModels: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/upstreams/:upstreamId/models`,
    auth: 'admin',
    params: z.object({ upstreamId: Id }),
    response: UpstreamModelList,
    summary:
      'v3.4：从该账号拉取可用模型列表（添加模型向导第 ② 步）；拉不到时 422 upstream_test_failed（details.reason），界面允许手填',
  }),
  getGatewayLimits: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/limits`,
    auth: 'admin',
    response: GatewayLimits,
    summary: 'v3.4：每用户并发 / 每分钟上限与账号健康参数',
  }),
  updateGatewayLimits: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/limits`,
    auth: 'admin',
    body: GatewayLimits,
    response: GatewayLimits,
    summary: 'v3.4：修改每用户限流与账号健康参数（写审计）',
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
  listModels: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/models`,
    auth: 'admin',
    response: z.object({ items: z.array(AdminModel) }),
    summary:
      'v3.3：后台「模型」页：目录条目 + 倍率（输入 / 输出 / 缓存，元 / 百万 token）+ 约每条积分',
  }),
  upsertModel: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/models/:modelKey`,
    auth: 'admin',
    params: z.object({ modelKey: z.string() }),
    body: AdminModelWrite,
    response: AdminModel,
    summary:
      'v3.3：新增或修改模型（目录 + 倍率一次保存）。倍率有变化时先自动生成并发布新价目表版本，再保存目录；path 中的 modelKey 需 URL 编码。其余规则同 upsertCatalogEntry',
  }),
} as const;

// ---------- 管理后台：用量与费用（ADM-08，v1.1） ----------
// 设计见 docs/architecture/billing.md 10.1 节。数据来自 model_access.usage_records：每次调用一行，
// 结算时把 billing 返回的扣费、成本、平台吸收成本记在同一行（快照，权威仍是 billing 流水，对账第 ② 层校验）。
// 查询条件较多（多选列表），所以三个查询接口都用 POST + 请求体；它们只读，不创建任何数据。
// 任何响应都不含消息内容、提示词或模型输出。

/** 分组维度。day 按北京时间自然日（与供应商账单日一致，billing.md 第 7 节）。 */
/** v3.4：新增 hour（北京时间「YYYY-MM-DD HH」，趋势图按小时）。 */
export const AdminUsageDimension = z.enum([
  'user',
  'character',
  'model',
  'purpose',
  'upstream',
  'day',
  'hour',
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
  unknownCostCalls: z.number().int().nonnegative().optional(),
  uncertainCostMicros: z.number().int().nonnegative().optional(),
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
  // ---- v3.4 用量监控 ----
  /** 用户扣除的积分（= chargedMicros ÷ 10,000）。 */
  chargedPoints: z.number().nonnegative().optional(),
  /** 平均耗时（毫秒，含失败调用）。 */
  avgLatencyMs: z.number().nonnegative().optional(),
  /** 失败率 0～1。 */
  failureRate: z.number().min(0).max(1).optional(),
  /** 缓存命中率 0～1 = 命中缓存的输入 token ÷（未命中 + 命中的输入 token）。 */
  cacheHitRate: z.number().min(0).max(1).optional(),
  /**
   * v3.6：理论可缓存占比 0～1 = 带「稳定开头」标记的调用里，稳定开头的估算 token ÷ 这些调用的全部输入 token
   * （目前只有私聊回复带标记）。与 cacheHitRate 对照：命中率明显低于它，说明上游没吃到缓存（换了账号、开头被改动等）。
   */
  stablePrefixRate: z.number().min(0).max(1).optional(),
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
  costKnown: z.boolean().optional(),
  uncertainCostMicros: z.number().int().nonnegative().optional(),
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
  /** v3.4：用户扣除的积分。 */
  chargedPoints: z.number().nonnegative().optional(),
  /** v3.4：实际调用的上游模型名。 */
  upstreamModelId: z.string().max(128).optional(),
  /** v3.6：这次请求「稳定开头」的估算 token 数；没有标记的调用为 null。 */
  stablePrefixTokens: z.number().int().nonnegative().nullable().optional(),
});
export type AdminUsageRecord = z.infer<typeof AdminUsageRecord>;

/** v3.4：用量看板概览（06-old-ui-spec 9.3）。 */
export const AdminUsageOverview = z.object({
  totals: AdminUsageTotals,
  /** 上一个等长时段的合计（「较昨日」）。 */
  previousTotals: AdminUsageTotals,
  accounts: z.object({
    total: z.number().int().nonnegative(),
    /** 启用、状态正常且不在暂停中的账号数。 */
    available: z.number().int().nonnegative(),
    /** 启用但状态异常或暂停中的账号数。 */
    abnormal: z.number().int().nonnegative(),
    disabled: z.number().int().nonnegative(),
  }),
  /** 最近 24 小时失败调用，按「账号 + 模型 + 错误类型」合并计数（最多 50 组，次数从多到少）。 */
  recentErrors: z.array(
    z.object({
      upstreamId: Id,
      modelKey: ModelKey,
      errorCode: z.string().max(64),
      count: z.number().int().positive(),
      lastAt: Timestamp,
    }),
  ),
});
export type AdminUsageOverview = z.infer<typeof AdminUsageOverview>;

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
  usageOverview: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/usage/overview`,
    auth: 'admin',
    body: z.object({
      from: Timestamp,
      to: Timestamp,
      upstreamIds: z.array(Id).min(1).max(50).optional(),
      modelKeys: z.array(ModelKey).min(1).max(50).optional(),
    }),
    response: AdminUsageOverview,
    summary:
      'v3.4：用量看板概览：汇总（调用、成功率、token、上游成本、用户扣除积分、平均耗时、缓存命中率）、上一时段对比、可用账号数、最近 24 小时错误（只读查询）',
  }),
} as const;
