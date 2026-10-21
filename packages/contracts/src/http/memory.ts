/** 用户可见记忆管理；来源/内容范围/所有者仅由服务端盖章。 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';
export const MemoryCategory = z.enum([
  'basic',
  'preference',
  'status',
  'people',
  'dates',
  'episode',
  'commitment',
]);
export const MemoryStatus = z.enum(['current', 'past']);
export const MemoryVisibility = z.enum(['default', 'only_this_character']);
export const MemorySharingClass = z.enum(['shareable', 'never', 'basic']);
export const MemoryEntry = z.object({
  memoryId: Id,
  characterId: Id,
  category: MemoryCategory,
  content: z.string().trim().min(1).max(1000),
  status: MemoryStatus,
  importance: z.number().int().min(1).max(10),
  dueAt: Timestamp.nullable(),
  visibility: MemoryVisibility,
  sharingClass: MemorySharingClass,
  scope: z.enum(['normal', 'adult']),
  sourceMessageIds: z.array(Id).max(100),
  createdBy: z.enum(['extracted', 'user_manual']),
  origin: z.enum(['private_chat', 'group', 'call', 'system']).optional(),
  knownBy: z.array(Id),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;
export const UpdateMemoryRequest = MemoryEntry.pick({
  content: true,
  category: true,
  status: true,
  importance: true,
  dueAt: true,
  visibility: true,
  sharingClass: true,
})
  .partial()
  .strict();
export const CreateMemoryRequest = z
  .object({
    /** 同用户同角色内幂等；不会被当作实际数据库主键。 */
    clientMemoryId: Id,
    content: z.string().trim().min(1).max(1000),
    category: MemoryCategory,
    importance: z.number().int().min(1).max(10).optional(),
    dueAt: Timestamp.nullable().optional(),
    visibility: MemoryVisibility.optional(),
  })
  .strict();
const params = z.object({ characterId: Id });
const itemParams = params.extend({ memoryId: Id });
export const MemoryEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/memories`,
    auth: 'user',
    params,
    query: z.object({
      afterId: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: z.object({ items: z.array(MemoryEntry), nextCursor: Id.nullable() }),
    summary: 'TA记住了什么（含成人来源，只有当前用户可管理）',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/:characterId/memories`,
    auth: 'user',
    params,
    body: CreateMemoryRequest,
    response: MemoryEntry,
    summary: '我想让TA记住…（幂等）',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/characters/:characterId/memories/:memoryId`,
    auth: 'user',
    params: itemParams,
    body: UpdateMemoryRequest,
    response: MemoryEntry,
    summary: '修正一条记忆，手动修改优先',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/characters/:characterId/memories/:memoryId`,
    auth: 'user',
    params: itemParams,
    response: NoContent,
    summary: '删除记忆并阻止旧来源重新抽取',
  }),
} as const;

// ---------- 3.18（v5 批 B）：记忆分档、长上下文（docs/refactor/16-membership-v5.md §5） ----------

/** 一档的记忆参数。null = 不限。 */
export const MemoryTierLimits = z
  .object({
    /** 常驻记忆（每次都带的重要事实）最多几条。 */
    residentLimit: z.number().int().min(0).max(50),
    /** 每个角色记忆库参与回复的条数上限（按记下的先后取最早的若干条）；超出的不删除，只是暂不参与。 */
    libraryLimit: z.number().int().min(1).max(1000).nullable(),
    /** 聊天摘要只用最近几天；null = 全部。 */
    summaryDays: z.number().int().min(1).max(3650).nullable(),
    /** 每次按话题回想几条。 */
    retrieveLimit: z.number().int().min(0).max(20),
    /** 翻聊天记录能翻最近几天；null = 全部。 */
    recallDays: z.number().int().min(1).max(3650).nullable(),
  })
  .strict();
export type MemoryTierLimits = z.infer<typeof MemoryTierLimits>;

/** 原文窗口参数（分段稳定窗口，docs/refactor/09 第 8 节）。 */
export const ChatWindowLimits = z
  .object({
    /** 前移后至少保留的用户轮数。 */
    keepTurns: z.number().int().min(4).max(2000),
    /** 超过这么多用户轮触发前移。 */
    triggerTurns: z.number().int().min(8).max(4000),
    /** 摘要一直没跟上时，超过这么多轮强制前移。 */
    maxTurns: z.number().int().min(10).max(6000),
    /** 窗口原文字数上限，超过且多于保留轮数也触发前移。 */
    triggerChars: z.number().int().min(2000).max(400_000),
  })
  .strict();
export type ChatWindowLimits = z.infer<typeof ChatWindowLimits>;

/** 管理后台可调的记忆分档参数。 */
export const MemoryTierConfig = z
  .object({
    free: MemoryTierLimits,
    proPlus: MemoryTierLimits,
    /** 新用户注册后前几天按 PRO+ 记忆体验（0 = 不送）。 */
    newUserTrialDays: z.number().int().min(0).max(60),
    /** 翻聊天记录每次最多取几条原话（0 = 关闭翻聊天记录）。 */
    recallTopK: z.number().int().min(0).max(10),
    groupMemoryMessageThreshold: z.number().int().min(5).max(100).optional(),
    groupMemoryIdleMinutes: z.number().int().min(1).max(120).optional(),
    /** 长上下文模式（PRO+ 可对单个角色打开）的原文窗口。 */
    longContext: ChatWindowLimits,
  })
  .strict();
export type MemoryTierConfig = z.infer<typeof MemoryTierConfig>;

/** 记忆页显示的「当前实际可用范围」。不含任何开通引导。 */
export const MemoryTierStatus = z.object({
  tier: z.enum(['free', 'pro_plus']),
  /** member = PRO+ 会员；new_user = 新用户前几天体验；free = 免费档。 */
  basis: z.enum(['member', 'new_user', 'free']),
  /** basis = new_user 时体验到何时。 */
  trialEndsAt: Timestamp.nullable(),
  limits: MemoryTierLimits,
  /** 该角色记忆库现有条数。 */
  libraryCount: z.number().int().nonnegative(),
  longContext: z.object({
    /** 当前账号能否打开（PRO+ 会员）。 */
    available: z.boolean(),
    /** 该角色是否已打开（不可用时恒为 false）。 */
    enabled: z.boolean(),
    /** 约每条积分（按所选聊天模型当前售价估算，窗口接近装满时）；无法估算为 null。 */
    pointsPerMessage: z.number().nonnegative().nullable(),
    /** 平时（未打开）约每条积分，同口径。 */
    normalPointsPerMessage: z.number().nonnegative().nullable(),
  }),
});
export type MemoryTierStatus = z.infer<typeof MemoryTierStatus>;

export const MemoryTierEndpoints = {
  /** 3.18：两档记忆参数（权益页对照用，不含个人数据）。 */
  plans: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/memory-tiers`,
    auth: 'user',
    response: MemoryTierConfig,
    summary: '免费 / PRO+ 两档记忆参数与新用户体验天数（权益页显示，3.18）',
  }),
  status: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/memory-tier`,
    auth: 'user',
    params,
    response: MemoryTierStatus,
    summary: '该角色记忆的实际可用范围与长上下文模式状态（3.18）',
  }),
  adminGet: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ai/memory-tiers`,
    auth: 'admin',
    response: MemoryTierConfig.extend({ updatedAt: Timestamp.nullable() }),
    summary: '记忆分档与长上下文参数（3.18）',
  }),
  adminUpdate: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/ai/memory-tiers`,
    auth: 'admin',
    body: MemoryTierConfig,
    response: MemoryTierConfig.extend({ updatedAt: Timestamp.nullable() }),
    summary: '修改记忆分档与长上下文参数，立即生效（3.18）',
  }),
} as const;
