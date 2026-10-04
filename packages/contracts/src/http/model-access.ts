/**
 * model-access 模块：BYOK 密钥、模型目录、模型选择、模型状态。
 * 需求：MDL-01、MDL-02、MDL-04（状态部分）；用量与预算（MDL-05）在 L2 扩展。
 * 安全规则：任何响应都不包含密钥原文或密文，只有前 4 后 4 位掩码（docs/architecture/security-and-privacy.md 第 3 节）。
 * 供应商列表、模型标签、排行榜数据的内容由 AI 系统负责人提供（T-005）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';

/** 供应商标识，例："deepseek"、"qwen"。取值由 AI 负责人维护在模型目录中，契约只约束格式。 */
export const ProviderId = z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/);
export type ProviderId = z.infer<typeof ProviderId>;

export const Provider = z.object({
  providerId: ProviderId,
  name: z.string(),
  /** 「去哪里申请」说明链接（MDL-01 第 2 条）。 */
  applyUrl: z.url(),
  /** 是否允许用户自填接口地址（兼容 OpenAI 格式的自定义服务）。 */
  allowsCustomBaseUrl: z.boolean(),
});
export type Provider = z.infer<typeof Provider>;

export const CredentialStatus = z.enum([
  'active',
  'invalid', // 密钥无效 / 被作废
  'quota_exhausted', // 余额不足
  'provider_unavailable', // 供应商暂时故障（重试后仍失败）
]);
export type CredentialStatus = z.infer<typeof CredentialStatus>;

/** 连通测试失败原因（MDL-01 第 3 条）。 */
export const CredentialTestFailure = z.enum([
  'invalid_key',
  'insufficient_balance',
  'network_error',
  'provider_error',
]);
export type CredentialTestFailure = z.infer<typeof CredentialTestFailure>;

export const Credential = z.object({
  credentialId: Id,
  providerId: ProviderId,
  /** 掩码，例："sk-a…9xQz"：前 4 位 + 省略号 + 后 4 位。 */
  maskedKey: z.string().max(16),
  baseUrl: z.url().nullable(),
  status: CredentialStatus,
  statusChangedAt: Timestamp,
  createdAt: Timestamp,
});
export type Credential = z.infer<typeof Credential>;

export const ModelCapability = z.enum(['vision', 'voice_input', 'voice_output', 'web_search', 'adult_content']);
export type ModelCapability = z.infer<typeof ModelCapability>;

export const PriceTier = z.enum(['cheap', 'medium', 'expensive']);

export const ModelInfo = z.object({
  providerId: ProviderId,
  /** 供应商侧的模型名。 */
  modelId: z.string().min(1).max(128),
  displayName: z.string(),
  priceTier: PriceTier,
  capabilities: z.array(ModelCapability),
  /** 展示标签，例：「中文好」「长记忆」，由 AI 负责人维护。 */
  tags: z.array(z.string()),
  leaderboardRank: z.number().int().positive().nullable(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

/** 指向「用哪把密钥的哪个模型」。 */
export const ModelRef = z.object({
  credentialId: Id,
  modelId: z.string().min(1).max(128),
});
export type ModelRef = z.infer<typeof ModelRef>;

export const ModelRefState = ModelRef.extend({
  /** 该选择当前是否可用（密钥被删、状态异常、模型下线时为 false，MDL-01 验收第 4 条）。 */
  available: z.boolean(),
  unavailableReason: z.enum(['credential_deleted', 'credential_status', 'model_removed']).nullable(),
});

/** 模型的三种用途（术语见 glossary：聊天模型、后台模型、成人模式模型）。 */
export const ModelRole = z.enum(['chat', 'background', 'adult']);
export type ModelRole = z.infer<typeof ModelRole>;

export const ModelSelection = z.object({
  chat: ModelRefState.nullable(),
  /** 不设置时后台功能沿用聊天模型（MDL-02 第 1 条）。 */
  background: ModelRefState.nullable(),
  adult: ModelRefState.nullable(),
});
export type ModelSelection = z.infer<typeof ModelSelection>;

export const UpdateModelSelectionRequest = z.object({
  chat: ModelRef.nullable().optional(),
  background: ModelRef.nullable().optional(),
  adult: ModelRef.nullable().optional(),
});

export const CharacterModelOverride = z.object({
  characterId: Id,
  chat: ModelRefState.nullable(),
});

/** 某个角色当前的模型可用状态，用于私聊顶部系统横条（MDL-04 第 2 条）。 */
export const ModelStatus = z.object({
  characterId: Id.nullable(),
  available: z.boolean(),
  reason: z.enum(['not_configured', 'invalid', 'quota_exhausted', 'provider_unavailable']).nullable(),
  /** 角色单独设置的模型失效、全局模型正常时为 true，界面显示「临时改用默认模型」按钮。 */
  canFallbackToDefault: z.boolean(),
});
export type ModelStatus = z.infer<typeof ModelStatus>;

export const CreateCredentialRequest = z.object({
  providerId: ProviderId,
  /** 密钥原文。服务器先去除首尾空白再测试（MDL-01 边界情况）。只在此请求中出现。 */
  apiKey: z.string().min(8).max(512),
  baseUrl: z.url().nullable().optional(),
  /** 同一供应商已存在时：false 返回 409 credential_exists，true 直接替换。 */
  replaceExisting: z.boolean().default(false),
});

export const CreateCredentialResponse = z.object({
  credential: Credential,
  /** 连通测试成功后，该密钥能用的模型列表。 */
  models: z.array(ModelInfo),
});

/** 连通测试失败时的 422 响应 details 结构。 */
export const CredentialTestFailedDetails = z.object({
  reason: CredentialTestFailure,
});

export const ModelAccessEndpoints = {
  listProviders: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/providers`,
    auth: 'user',
    response: z.object({ items: z.array(Provider) }),
    summary: '支持的供应商列表（MDL-01）',
  }),
  listCredentials: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/credentials`,
    auth: 'user',
    response: z.object({ items: z.array(Credential) }),
    summary: '已保存的密钥（只有掩码）',
  }),
  createCredential: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/model/credentials`,
    auth: 'user',
    body: CreateCredentialRequest,
    response: CreateCredentialResponse,
    summary:
      '保存密钥：先连通测试，成功才保存（10 秒内返回）。失败 422 credential_test_failed（details.reason），重复 409 credential_exists',
  }),
  deleteCredential: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/model/credentials/:credentialId`,
    auth: 'user',
    params: z.object({ credentialId: Id }),
    response: NoContent,
    summary: '删除密钥；依赖它的模型选择变为不可用',
  }),
  listModels: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/models`,
    auth: 'user',
    query: z.object({ providerId: ProviderId.optional() }),
    response: z.object({ items: z.array(ModelInfo) }),
    summary: '模型目录（带价格档位、能力、标签、排行名次）',
  }),
  getSelection: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/selection`,
    auth: 'user',
    response: ModelSelection,
    summary: '全局模型选择（MDL-02）',
  }),
  updateSelection: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/model/selection`,
    auth: 'user',
    body: UpdateModelSelectionRequest,
    response: ModelSelection,
    summary: '修改全局模型选择；成人模式模型必须具备 adult_content 能力',
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
    summary: '为角色单独设置聊天模型；null 表示恢复使用全局默认（MDL-02 第 2 条、MDL-06）',
  }),
  getModelStatus: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/model/status`,
    auth: 'user',
    query: z.object({ characterId: Id.optional() }),
    response: ModelStatus,
    summary: '模型可用状态，用于系统横条（MDL-04）',
  }),
} as const;
