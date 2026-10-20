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
 * 3.24（2026-10-21，试用反馈第二轮 F2）：上游协议新增 anthropic（Claude 原生 Messages）；倍率增「缓存写入 5 分钟 / 1 小时」；
 * 去掉「图片识别」场景（图片随文本聊天 / 私密模式模型）；计费上限的资料链接与核对日期改为可选；模型「暂时无法使用」带具体原因；
 * 榜单自动获取（榜单对应名称、抓取状态、立即刷新、粘贴导入），用户端名次按相对顺序重新编号。
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

/**
 * 3.22（试用反馈批 E3）：模型使用场景。每个场景用户单独选一个模型（不做多模态「直接听语音 / 直接生成」）。
 * - chat 文本聊天（私聊、群聊回复；记忆整理、角色生态里「发文字」等后台文字任务也按它走）；
 *   3.24 起用户发的图片也随文本聊天模型（私密模式下随私密模式模型）发送，文本聊天 / 私密模式模型应具备识图能力；
 * - vision 图片识别：**3.24 起不再使用**（服务器不再返回这个场景、忽略对它的写入，0119 迁移已清除旧配置）；
 *   取值保留只为旧客户端能解析；
 * - voice_message 语音消息（角色发语音的合成；角色音色绑定了具体语音模型时以音色为准）；
 * - speech_recognition 语音识别（用户语音转文字，含通话里听用户）；
 * - voice_call 语音通话（通话中对话用的文本模型）；
 * - image_generation 发照片 / 自拍（图片生成）；
 * - private 私密模式聊天（原「成人模式模型」）。
 */
export const ModelScenario = z.enum([
  'chat',
  'vision',
  'voice_message',
  'speech_recognition',
  'voice_call',
  'image_generation',
  'private',
]);
export type ModelScenario = z.infer<typeof ModelScenario>;

/**
 * 3.22：平台内部模型（用户不可选，后台指定）。safety 安全检查与关怀跟进；small_v 小V 答疑；
 * platform_content 平台承担的内容生成（官方角色公共朋友圈、搜索候选）；planner 行为规划；
 * adult_check 成人内容检查（须 OpenRouter）；web_search 联网搜索。
 * 「角色生态决策」模型仍存在生态配置里（后台模型页同一栏可改），不在这里。
 */
export const PlatformInternalUse = z.enum([
  'safety',
  'small_v',
  'platform_content',
  'planner',
  'adult_check',
  'web_search',
]);
export type PlatformInternalUse = z.infer<typeof PlatformInternalUse>;

/** 3.22：限时折扣（后台设置）。rate 0.01～0.99（最多 2 位小数）；[startsAt, endsAt) 期间生效，到期自动恢复原价。 */
export const ModelDiscount = z
  .object({
    rate: z.number().min(0.01).max(0.99),
    startsAt: Timestamp,
    endsAt: Timestamp,
  })
  .refine((d) => Date.parse(d.endsAt) > Date.parse(d.startsAt), {
    message: '结束时间必须晚于开始时间',
    path: ['endsAt'],
  });
export type ModelDiscount = z.infer<typeof ModelDiscount>;

/** 3.22：用户端看到的进行中折扣。 */
export const ModelDiscountInfo = z.object({
  rate: z.number().min(0.01).max(0.99),
  endsAt: Timestamp,
});

/**
 * 3.24：模型「暂时无法使用」的具体原因（后台与用户端都按它写清楚，不只写「暂时无法使用」）。
 * - model_removed 已下架 / 删除；no_route 没有可用线路；upstream_disabled 线路的上游账号都被停用；
 * - upstream_invalid_key 上游密钥无效；upstream_quota_exhausted 上游余额不足；
 * - upstream_unavailable 上游连接异常，被健康检查暂停（探测连通后自动恢复）；upstream_cooldown 连续失败后短暂暂停；
 * - billing_bounds_missing 线路缺计费上限；billing_bounds_paused 用量核对未通过，线路已暂停；
 * - price_missing 当前价目表没有这个模型的价格；output_limit_too_small 线路最大输出小于一条回复需要的额度。
 * 客户端用 tolerantEnum 解析：不认识的新原因显示通用「暂时无法使用」。
 */
export const ModelUnavailableDetailValue = z.enum([
  'model_removed',
  'no_route',
  'upstream_disabled',
  'upstream_invalid_key',
  'upstream_quota_exhausted',
  'upstream_unavailable',
  'upstream_cooldown',
  'billing_bounds_missing',
  'billing_bounds_paused',
  'price_missing',
  'output_limit_too_small',
]);
export type ModelUnavailableDetail = z.infer<typeof ModelUnavailableDetailValue>;
export const ModelUnavailableDetail = tolerantEnum(ModelUnavailableDetailValue);

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
  /**
   * 榜单名次。3.24 起是**相对名次**：本次返回的列表里有名次的模型按原榜名次排序后重新编号 1、2、3…N
   * （原榜第 1、3、4、9 名 → 1、2、3、4），不显示原始名次；没上榜为 null。
   */
  leaderboardRank: z.number().int().positive().nullable(),
  /** 当前是否可用（上游故障时为 false，下架的模型不出现在列表中）。 */
  available: z.boolean(),
  /** 3.24：不可用的具体原因（available = true 时为 null / 不带）。 */
  unavailableDetail: tolerantEnum(ModelUnavailableDetailValue).nullable().optional(),
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
  /** 3.22：后台标注这个模型可用于哪些场景（模型配置页按场景只列可用的模型）。 */
  scenarios: z.array(tolerantEnum(ModelScenario)).optional(),
  /**
   * 3.22：进行中的限时折扣（没有或已过期为 null / 不带）。rate = 折扣系数（0.5 = 5 折），
   * 扣费按「售价 × rate」，pointsPerReply / pointsPerUse 已是折后数；displayMultiplier 仍是原倍率，
   * 界面显示「消耗倍率 ~~×1.0~~ ×0.5 · 限时 5 折」。
   */
  discount: ModelDiscountInfo.nullable().optional(),
  /**
   * 3.22：按场景估算「约每次多少积分」（已含折扣）：文本类场景（文本聊天 / 图片识别 / 语音通话 / 私密模式）= 约每条回复；
   * 语音消息 = 约 100 字一条；语音识别 = 约 15 秒一条；发照片 = 1 张。算不出为 null，不适用的场景不带。
   */
  pointsPerUse: z
    .object({
      chat: z.number().nonnegative().nullable(),
      vision: z.number().nonnegative().nullable(),
      voice_message: z.number().nonnegative().nullable(),
      speech_recognition: z.number().nonnegative().nullable(),
      voice_call: z.number().nonnegative().nullable(),
      image_generation: z.number().nonnegative().nullable(),
      private: z.number().nonnegative().nullable(),
    })
    .partial()
    .optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

// ---------- 用户的模型选择 ----------

export const ModelRef = z.object({ modelKey: ModelKey });
export type ModelRef = z.infer<typeof ModelRef>;

export const ModelRefState = ModelRef.extend({
  /** 该选择当前是否可用。 */
  available: z.boolean(),
  unavailableReason: z.enum(['model_removed', 'provider_unavailable']).nullable(),
  /** 3.24：不可用的具体原因（可用时为 null / 不带）。 */
  unavailableDetail: ModelUnavailableDetail.nullable().optional(),
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
  /** 3.24：reason 为 provider_unavailable / model_removed 时的具体原因（横条按它写清楚）。 */
  detail: ModelUnavailableDetail.nullable().optional(),
  /**
   * 3.1（积压 ㉚）：识图能否使用（截图导入、发图给角色看）= 解析出的聊天模型有 vision 能力。
   * 3.24 起只看文本聊天模型（不再有图片识别场景）。客户端据此提前禁用截图导入入口；旧服务器不带时按 true（失败时再提示）。
   */
  visionAvailable: z.boolean().optional(),
});
export type ModelStatus = z.infer<typeof ModelStatus>;

/** 3.22：每个场景一项（字段名 = 场景）；未传的场景不改，null = 清除。 */
export const ScenarioRefs = z
  .object({
    chat: ModelRef.nullable(),
    vision: ModelRef.nullable(),
    voice_message: ModelRef.nullable(),
    speech_recognition: ModelRef.nullable(),
    voice_call: ModelRef.nullable(),
    image_generation: ModelRef.nullable(),
    private: ModelRef.nullable(),
  })
  .partial();

/** 3.22：用户在某个场景的配置。 */
export const ScenarioSelection = z.object({
  scenario: tolerantEnum(ModelScenario),
  /** 用户选的模型；null = 未配置（该场景的功能不可用，首次使用时引导配置）。 */
  selection: ModelRefState.nullable(),
  /** 后台为该场景指定的推荐模型（只用于「一键选推荐」，不是兜底默认）；未指定为 null。 */
  recommendedModelKey: ModelKey.nullable(),
});

export const ScenarioConfig = z.object({
  scenarios: z.array(ScenarioSelection),
  /** 文本聊天还没配置：客户端弹出首次引导，配置前不能发消息。 */
  needsSetup: z.boolean(),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfig>;

export const UpdateScenarioConfigRequest = z.object({ selections: ScenarioRefs });

/** 3.22：某角色逐场景的单独设置；selection = null 表示跟随场景设置，effective = 实际会用的模型。 */
export const CharacterScenarioConfig = z.object({
  characterId: Id,
  scenarios: z.array(
    z.object({
      scenario: tolerantEnum(ModelScenario),
      selection: ModelRefState.nullable(),
      effective: ModelRefState.nullable(),
    }),
  ),
});
export type CharacterScenarioConfig = z.infer<typeof CharacterScenarioConfig>;

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
    query: z.object({
      capability: ModelCapability.optional(),
      scenario: ModelScenario.optional(),
    }),
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
  getScenarioConfig: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/scenarios`,
    auth: 'user',
    response: ScenarioConfig,
    summary: '3.22：按场景的模型配置（含后台推荐模型、是否需要首次引导）',
  }),
  updateScenarioConfig: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/model/scenarios`,
    auth: 'user',
    body: UpdateScenarioConfigRequest,
    response: ScenarioConfig,
    summary:
      '3.22：修改场景配置。模型须启用且后台标注可用于该场景（否则 422 model_unavailable）；私密模式以外的场景不能选无审查模型（422 model_not_allowed）',
  }),
  applyRecommendedScenarios: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/model/scenarios/recommended`,
    auth: 'user',
    body: z.object({ overwrite: z.boolean().optional() }),
    response: ScenarioConfig,
    summary:
      '3.22：一键选推荐：把后台推荐模型写入未配置的场景（overwrite = true 时覆盖全部）；私密模式不自动选',
  }),
  getCharacterScenarios: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/character-scenarios/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: CharacterScenarioConfig,
    summary: '3.22：某角色逐场景的单独设置（未指定 = 跟随场景设置）',
  }),
  updateCharacterScenarios: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/model/character-scenarios/:characterId`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: UpdateScenarioConfigRequest,
    response: CharacterScenarioConfig,
    summary:
      '3.22：为角色逐场景单独指定模型（null = 跟随场景设置）。无审查模型只能给有成人资格的角色，否则 403 model_not_allowed',
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
/**
 * 3.24：anthropic = Claude 原生 Messages 接口（`POST {baseUrl}/v1/messages`，x-api-key 鉴权）：system 单独传、
 * 稳定开头打缓存断点（cache_control）、读回缓存读取 / 写入（5 分钟 / 1 小时）用量。中转站给的 Claude 地址填在 baseUrl
 * （带不带 /v1 都可以）。只用于文本模型；只在管理端出现。
 */
export const UpstreamKind = z.enum([
  'openai_compatible',
  'dashscope',
  'bocha_search',
  'jev',
  'anthropic',
]);

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
  /** 3.24：改协议（例 OpenAI 兼容 → Anthropic）；与改地址一样清空冷却、按「需要重新测试」处理。 */
  kind: UpstreamKind.optional(),
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

/** v3.4：从上游账号拉取到的可用模型（OpenAI 兼容 GET {baseUrl}/models；3.24 Anthropic 协议 GET {baseUrl}/v1/models 的 id 列表）。 */
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

/**
 * 3.16：管理员依据供应商规格核准，绑定到具体路由；缺失即调用前拒绝，不猜模型上限。
 * 3.24：sourceUrl（资料来源链接）、checkedAt（核对时间）改为可选，后台表单不再填写。保存时没带 checkedAt 的，
 * 服务器记为保存时刻（用于判断「用量未知暂停」与重新核对的先后）；带了的不能晚于服务器当前时间。
 */
export const RouteBillingBounds = z
  .object({
    format: z.literal('billing-bounds-v1'),
    pauseReason: z.literal('usage_unknown').optional(),
    sourceUrl: z
      .url({ protocol: /^https$/ })
      .max(2048)
      .optional(),
    checkedAt: Timestamp.optional(),
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
  /** 手填的榜单名次（原榜名次）；3.24 起自动获取的榜单里匹配到的名次优先（见 arenaModelName）。 */
  leaderboardRank: z.number().int().positive().nullable(),
  /**
   * 3.24：榜单对应名称（榜单上这个模型叫什么，例 claude-opus-4-8）；自动获取榜单时按它匹配名次
   * （不区分大小写、忽略首尾空白）。写入时不传 = 保持原值；null = 清除。导入配置时取文件的 arena_model。
   */
  arenaModelName: z.string().trim().min(1).max(120).nullable().optional(),
  sortOrder: z.number().int(),
  /**
   * 作为平台默认模型（每种最多一个）；无审查模型不能设为默认。
   * v1.1：vision = 平台默认识图模型（pm-rulings-2 B5、PRD ADM-05 第 9 条）：用途为 vision 时，
   * 若用户（或角色覆盖）解析出的聊天模型没有 vision 能力，网关改用它，费用照常从用户余额扣；
   * 必须具备 vision 能力；未设置时网关返回 capability_missing（billing.md 3.2 节）。
   * 3.0：planner = 行为规划默认模型（CR-17，只能用于 behavior_planning）；speech_synthesis / speech_recognition /
   * image_generation / web_search = 平台提供的语音合成、语音识别、图片生成、联网搜索服务（MED，平台未设置即「未开通」）。
   * **3.22 起不再使用**：平台默认改为「场景推荐模型」与「平台内部模型」（ModelScenarioSettings），
   * 服务器忽略写入的值、返回空数组；字段保留只为旧客户端能解析。
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
  /** 3.22：可用于哪些场景（后台勾选）；写入时不传 = 保持原值（新建为空）。 */
  scenarios: z.array(ModelScenario).optional(),
  /** v3.6：系统消息放法；写入时不传 = 保持原值（新建默认 multi）。 */
  systemMessageMode: SystemMessageMode.optional(),
  billingBounds: RouteBillingBounds.nullable().optional(),
  updatedAt: Timestamp,
  /**
   * 3.23：删除时间（软删）。非空 = 已删除：不在用户端、场景可选列表、推荐 / 内部模型里，线路已删除，
   * 恒为停用；列表仍返回它（modelKey 为删除前的键），只为让历史调用记录、用量、对账能显示模型名。
   * 后台的模型表格与各处模型选择应隐藏它。删除后可以用同一个键重新添加（与已删除的记录互不影响）。
   */
  deletedAt: Timestamp.nullable().optional(),
});
export type AdminCatalogEntry = z.infer<typeof AdminCatalogEntry>;

export const AdminCatalogEntryWrite = AdminCatalogEntry.omit({ updatedAt: true, deletedAt: true });

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
  /**
   * 3.24：缓存写入价（元 / 百万 token，可选；5 分钟 / 1 小时两档，按上游提供的填）。上游报告缓存写入 token 时按它计价
   * （Anthropic 原生协议会报告）；不填 / null = 按普通输入价（input）计。OpenAI 兼容通道通常只报告缓存读取。
   * 中转站的分档价格（按用量档位）目前只用基础档。
   */
  cacheWrite5m: z.number().nonnegative().max(100_000).nullable().optional(),
  cacheWrite1h: z.number().nonnegative().max(100_000).nullable().optional(),
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
  /** 3.22：限时折扣设置（含未开始 / 已结束的）；null = 没有。 */
  discount: ModelDiscount.nullable().optional(),
  /** 3.22：折扣此刻是否生效。 */
  discountActive: z.boolean().optional(),
  /** 3.24：自动获取的榜单里按榜单对应名称匹配到的原榜名次；没有快照或没匹配上为 null。 */
  arenaRank: z.number().int().positive().nullable().optional(),
  /** 3.24：此刻对用户是否可用及具体原因（与用户端同一口径）。 */
  availability: z
    .object({ available: z.boolean(), detail: ModelUnavailableDetail.nullable() })
    .optional(),
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
  /** 3.22：限时折扣；null = 取消折扣；不传 = 不改。扣费按折后售价，成本不变。 */
  discount: ModelDiscount.nullable().optional(),
});

/**
 * 3.22：场景推荐模型（只用于用户端「一键选推荐」）与平台内部模型（用户不可选）。
 * 字段名 = 场景 / 内部用途；null = 未指定。推荐模型须启用且可用于该场景；内部模型不能是无审查模型
 * （adult_check 除外）。3.24：recommended.vision 不再使用（忽略写入、不再返回）。
 */
export const ModelScenarioSettings = z.object({
  recommended: z
    .object({
      chat: ModelKey.nullable(),
      vision: ModelKey.nullable(),
      voice_message: ModelKey.nullable(),
      speech_recognition: ModelKey.nullable(),
      voice_call: ModelKey.nullable(),
      image_generation: ModelKey.nullable(),
      private: ModelKey.nullable(),
    })
    .partial(),
  internal: z
    .object({
      safety: ModelKey.nullable(),
      small_v: ModelKey.nullable(),
      platform_content: ModelKey.nullable(),
      planner: ModelKey.nullable(),
      adult_check: ModelKey.nullable(),
      web_search: ModelKey.nullable(),
    })
    .partial(),
});
export type ModelScenarioSettings = z.infer<typeof ModelScenarioSettings>;

/** 3.23：删除模型（单个 / 批量）。键必须是现存（未删除）的模型。 */
export const DeleteModelsRequest = z.object({
  modelKeys: z
    .array(ModelKey)
    .min(1)
    .max(100)
    .refine((keys) => new Set(keys).size === keys.length, { message: '模型键不能重复' }),
});
export type DeleteModelsRequest = z.infer<typeof DeleteModelsRequest>;

/**
 * 3.23：删除模型会清理的引用（预览 = 将要清理；执行 = 已清理）。
 * 用户的场景配置 / 角色设置被清掉后回到「未配置」/「跟随」，由首次引导重新选。
 */
export const ModelDeletionImpact = z.object({
  models: z.array(z.object({ modelKey: ModelKey, displayName: z.string(), enabled: z.boolean() })),
  /** 场景配置里用到这些模型的用户数（去重）与配置条数。 */
  users: z.number().int().nonnegative(),
  scenarioSelections: z.number().int().nonnegative(),
  /** 单独指定了这些模型的角色数（按「用户 × 角色」去重）与设置条数。 */
  characters: z.number().int().nonnegative(),
  characterOverrides: z.number().int().nonnegative(),
  /** 场景推荐模型里用到它们的场景、平台内部模型里用到它们的用途。 */
  recommended: z.array(ModelScenario),
  internal: z.array(PlatformInternalUse),
  /** 线路条数、限时折扣个数、当前价目表里有价格的模型个数。 */
  routes: z.number().int().nonnegative(),
  discounts: z.number().int().nonnegative(),
  pricedModels: z.number().int().nonnegative(),
  /** 展示倍率的基准模型是其中之一（删除后改为未设置）。 */
  displayMultiplierBase: z.boolean(),
  /** 只在执行结果里：去掉这些模型后发布的新价目表版本；没有价格要去掉时为 null。 */
  priceVersionId: Id.nullable().optional(),
});
export type ModelDeletionImpact = z.infer<typeof ModelDeletionImpact>;

/** 3.17：展示倍率的基准模型（倍率 = 1.00 的那个）；null = 未设置，自动倍率不显示。 */
export const DisplayMultiplierSettings = z.object({ baseModelKey: ModelKey.nullable() });
export type DisplayMultiplierSettings = z.infer<typeof DisplayMultiplierSettings>;

/**
 * 3.24：自动获取的榜单状态（后台「模型管理」顶部）。服务器每天抓取一次榜单来源链接（也可「立即刷新」）；
 * 网站开启人机验证等原因抓不到时保留上次结果、写明原因，可改用「粘贴榜单文本 / CSV」导入。
 */
export const LeaderboardSnapshotStatus = z.object({
  source: ModelLeaderboardSource.nullable(),
  /** 当前生效的榜单快照（没有为 null）。 */
  snapshot: z
    .object({
      fetchedAt: Timestamp,
      /** fetch = 服务器自动抓取；paste = 后台粘贴 / 上传导入。 */
      method: z.enum(['fetch', 'paste']),
      entries: z.number().int().nonnegative(),
    })
    .nullable(),
  /** 最近一次抓取 / 导入尝试的时间与失败原因（成功时 lastError 为 null）。 */
  lastAttemptAt: Timestamp.nullable(),
  lastError: z.string().max(300).nullable(),
  /** 启用的模型里匹配上的（原榜名次、用户端相对名次）。 */
  matched: z.array(
    z.object({
      modelKey: ModelKey,
      displayName: z.string(),
      arenaModelName: z.string(),
      rank: z.number().int().positive(),
      relativeRank: z.number().int().positive(),
    }),
  ),
  /** 启用的模型里没匹配上的（没填榜单对应名称时 arenaModelName 为 null）：用户端不显示名次、排在后面。 */
  unmatched: z.array(
    z.object({
      modelKey: ModelKey,
      displayName: z.string(),
      arenaModelName: z.string().nullable(),
    }),
  ),
});
export type LeaderboardSnapshotStatus = z.infer<typeof LeaderboardSnapshotStatus>;

/** 3.24：粘贴导入榜单：从网页复制的表格文本或 CSV（含「名次 / 模型名」），最多 1MB。 */
export const ImportLeaderboardRequest = z.object({ text: z.string().min(1).max(1_000_000) });

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
  getScenarioSettings: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/scenario-settings`,
    auth: 'admin',
    response: ModelScenarioSettings,
    summary: '3.22：场景推荐模型与平台内部模型',
  }),
  updateScenarioSettings: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/model/scenario-settings`,
    auth: 'admin',
    body: ModelScenarioSettings,
    response: ModelScenarioSettings,
    summary: '3.22：修改场景推荐模型与平台内部模型（只改传了的键，写审计）',
  }),
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
  getLeaderboardStatus: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/model/leaderboard-status`,
    auth: 'admin',
    response: LeaderboardSnapshotStatus,
    summary: '3.24：自动获取的榜单状态（快照时间、失败原因、匹配 / 未匹配的模型）',
  }),
  refreshLeaderboard: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/leaderboard/refresh`,
    auth: 'admin',
    response: LeaderboardSnapshotStatus,
    summary:
      '3.24：立即抓取榜单来源链接；失败保留上次结果，lastError 写明原因（例 网站开启人机验证）。写审计',
  }),
  importLeaderboard: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/leaderboard/import`,
    auth: 'admin',
    body: ImportLeaderboardRequest,
    response: LeaderboardSnapshotStatus,
    summary:
      '3.24：粘贴榜单文本 / CSV 导入（抓取不到时的兜底）；一条都解析不出时 422 bad_request。写审计',
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
  previewDeleteModels: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/models/delete-preview`,
    auth: 'admin',
    body: DeleteModelsRequest,
    response: ModelDeletionImpact,
    summary: '3.23：删除模型前预览受影响的引用（只读）；有不存在或已删除的键时 404 not_found',
  }),
  deleteModels: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/model/models/delete`,
    auth: 'admin',
    body: DeleteModelsRequest,
    response: ModelDeletionImpact,
    summary:
      '3.23：删除模型（软删，可批量）：删线路，清用户场景配置 / 角色设置 / 场景推荐 / 平台内部模型 / 展示倍率基准 / 折扣，发布不含它们的新价目表（历史版本保留）；历史调用记录仍显示模型名；同键可重新添加。写审计',
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
  /** 3.24：缓存写入 token（5 分钟 + 1 小时；只有 Anthropic 原生协议会报告）。 */
  cacheWriteTokens: z.number().int().nonnegative().optional(),
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
  /** 缓存命中率 0～1 = 命中缓存的输入 token ÷（未命中 + 命中 + 缓存写入的输入 token）。 */
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
  /** 3.24：缓存写入 token（5 分钟 / 1 小时）；只有 Anthropic 原生协议会报告。 */
  cacheWrite5mTokens: z.number().int().nonnegative().optional(),
  cacheWrite1hTokens: z.number().int().nonnegative().optional(),
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
