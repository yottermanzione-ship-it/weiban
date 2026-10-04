/**
 * model-access 模块：模型目录、用户的模型选择、模型可用状态；管理后台的上游（平台密钥）与模型目录维护。
 * 需求：MDL（PRD v1.2 计费章节）。设计见 docs/architecture/billing.md 第 3、9 节，决策 ADR-0012。
 *
 * v0.2（T-009）：BYOK 全部删除。用户不再填写密钥，只选择平台模型目录里的模型（modelKey）。
 * 安全规则：任何响应都不包含上游密钥原文或密文，只有前 4 后 4 位掩码（docs/architecture/security-and-privacy.md 第 3 节）。
 * 价格不在本文件：见 http/billing.ts（价目表归 billing 模块）。模型清单、标签、排行榜数据由 AI 负责人维护（docs/ai/model-catalog.md）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';

// ---------- 模型目录 ----------

/** 平台内的模型键，例 "deepseek/deepseek-v4-pro"。用户选择、价目表、用量都用它。 */
export const ModelKey = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,47}\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/);
export type ModelKey = z.infer<typeof ModelKey>;

/**
 * 模型能力。adult_content = 无审查 / 允许成人内容的模型：只能用于有成人资格的角色
 * （hard-boundaries.md 第 4 节「模型层闸门」、billing.md 第 9 节）。
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
  capabilities: z.array(ModelCapability),
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
  adult: ModelRefState.nullable(),
});
export type ModelSelection = z.infer<typeof ModelSelection>;

/**
 * 修改全局模型选择。chat / background 不能选 adult_content 模型（422 model_not_allowed），
 * 因为全局选择会作用到真人和儿童角色；adult 必须选 adult_content 模型。
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
    summary: '修改全局模型选择。chat / background 选无审查模型 → 422 model_not_allowed；adult 选非无审查模型 → 422 model_not_allowed',
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
    summary: '为角色单独设置聊天模型；null 恢复使用全局默认。无审查模型只能给有成人资格的角色设置，否则 403 model_not_allowed',
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

export const UpstreamTestFailure = z.enum(['invalid_key', 'insufficient_balance', 'network_error', 'provider_error']);

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
  /** 作为平台默认聊天 / 后台模型（各最多一个）；无审查模型不能设为默认。 */
  defaultFor: z.array(z.enum(['chat', 'background'])),
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
    summary: '登记上游：先连通测试（记平台账户），成功才保存。失败 422 upstream_test_failed（details.reason）',
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
    summary: '新增或修改模型目录条目；改指上游、停用都记审计日志。path 中的 modelKey 需 URL 编码',
  }),
} as const;
