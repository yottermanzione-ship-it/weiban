/**
 * ai-runtime 对用户 / 管理员开放的 3.0 接口（L4～L7，T-062）。数据归 ai-runtime。
 * - 跨角色共享开关（MEM-07 第 1 条）；
 * - 群聊陪伴设置：回复节奏（秒回）、「角色自己聊天」、群聊情景模式（SOC-03 第 3、4 条）；
 * - P-45「不方便」静默与专注中的「所有角色安静」状态（只读，供客户端显示与排查）；
 * - 行为规划管理端（PLAN-03 第 2 条、ADM-05 第 10 条，AI 变更申请 CR-19）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, cursorPage, defineEndpoint, tolerantEnum } from '../common.js';
import { ScenarioMode, ScenarioModeOption } from './companion.js';

// ---------- 跨角色共享（MEM-07） ----------

/** off = 关闭；basic = 仅基础资料；friends = 朋友之间共享（默认）。 */
export const MemorySharingLevel = z.enum(['off', 'basic', 'friends']);

export const MemorySharingSettings = z.object({ level: MemorySharingLevel, updatedAt: Timestamp });

export const MemorySharingEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/memory-sharing`,
    auth: 'user',
    response: MemorySharingSettings,
    summary: '设置 → 隐私 → 跨角色共享（MEM-07 第 1 条），默认 friends',
  }),
  update: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/me/memory-sharing`,
    auth: 'user',
    body: z.object({ level: MemorySharingLevel }),
    response: MemorySharingSettings,
    summary: '修改共享档位，立即生效（关闭后其他角色不再使用转述来的记忆）',
  }),
} as const;

// ---------- 群聊陪伴设置（SOC-03、SOC-04、SOC-05） ----------

export const GroupCompanionSettings = z.object({
  conversationId: Id,
  /** 秒回（SOC-04 第 4 条），群聊单独设置，默认关。 */
  instantReply: z.boolean(),
  /** 「角色自己聊天」（SOC-05），默认开。 */
  selfChatEnabled: z.boolean(),
  /** 群聊情景模式，只作用于本群。 */
  scenarioMode: tolerantEnum(ScenarioMode),
  updatedAt: Timestamp,
});
export type GroupCompanionSettings = z.infer<typeof GroupCompanionSettings>;

const GroupParams = z.object({ conversationId: Id });

export const GroupCompanionEndpoints = {
  getSettings: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/groups/:conversationId/companion-settings`,
    auth: 'user',
    params: GroupParams,
    response: GroupCompanionSettings,
    summary: '群聊信息页微伴专属一组：情景模式、角色自己聊天、回复节奏',
  }),
  updateSettings: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/groups/:conversationId/companion-settings`,
    auth: 'user',
    params: GroupParams,
    body: z.object({
      instantReply: z.boolean().optional(),
      selfChatEnabled: z.boolean().optional(),
      scenarioMode: ScenarioMode.optional(),
    }),
    response: GroupCompanionSettings,
    summary:
      '修改群聊设置；scenarioMode 必须所有成员都具备资格（policy.checkGroupScenarioMode），否则 403 adult_mode_not_eligible / romance_not_allowed',
  }),
  listModes: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/groups/:conversationId/scenario-modes`,
    auth: 'user',
    params: GroupParams,
    response: z.object({ items: z.array(ScenarioModeOption) }),
    summary: '本群可选的情景模式 = 所有成员都具备资格的模式（SOC-03 第 4 条）；不具备的不返回',
  }),
} as const;

// ---------- 安静状态（P-45、PLAY-06） ----------

export const QuietState = z.object({
  /** 用户说过「不方便」：到此时间前所有角色不发语音、不主动来电（P-45，对该用户的所有角色生效）；没有为 null。 */
  inconvenientUntil: Timestamp.nullable(),
  /** 正在专注：到此时间前所有角色的主动消息延后、来电不拨出、群聊不自发（PLAY-06 第 3 条）；没有为 null。 */
  focusUntil: Timestamp.nullable(),
});
export type QuietState = z.infer<typeof QuietState>;

export const QuietStateEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/quiet-state`,
    auth: 'user',
    response: QuietState,
    summary:
      '当前的「不方便」静默与专注安静状态（只读；P-45 由 ai-runtime 识别聊天内容自动设置，用户再发消息时提前结束）',
  }),
} as const;

// ---------- 行为规划管理端（CR-19） ----------

/** 决策类型（docs/ai/behavior-planning.md 2.1）。 */
export const PlanningDecisionType = z.enum([
  'reply_form',
  'reply_timing',
  'quirk',
  'proactive_slot',
  'call_slot',
  'moments_plan',
  'play_slot',
]);
export type PlanningDecisionType = z.infer<typeof PlanningDecisionType>;

export const PlannerImplementation = z.enum(['rules', 'rules_model', 'jev']);

export const PlanningFallback = z.enum([
  'low_confidence',
  'timeout',
  'error',
  'budget',
  'cost_guard',
  'circuit_open',
  'invalid_choice',
]);

export const PlannerConfigEntry = z.object({
  decisionType: tolerantEnum(PlanningDecisionType),
  implementation: tolerantEnum(PlannerImplementation),
  /** rules_model / jev 用的模型；rules 为 null。 */
  modelKey: z.string().nullable(),
  /** 置信度门槛，0.3～0.9，默认 0.55。 */
  confidenceThreshold: z.number().min(0.3).max(0.9),
  /** 最近一次切换所依据的评测报告编号（docs/ai/eval-runs/）。 */
  evalReportId: z.string().max(64).nullable(),
  updatedBy: Id.nullable(),
  updatedAt: Timestamp,
  /**
   * 3.1（积压 ㊱）：熔断状态。熔断打开（模型版连续失败、暂时退回规则版）时为下次恢复尝试时间，否则 null。
   * 熔断目前只在单台服务器内存里统计（docs/ai/behavior-planning.md），多实例部署时返回处理本请求那台的状态。
   */
  circuitOpenUntil: Timestamp.nullable().optional(),
});

export const PlanningDecisionRecord = z.object({
  decisionId: Id,
  userId: Id,
  characterId: Id.nullable(),
  conversationId: Id.nullable(),
  decisionType: tolerantEnum(PlanningDecisionType),
  options: z.array(z.string()),
  choice: z.string(),
  confidence: z.number().min(0).max(1),
  /** ≤ 40 字，例「用户说在上课 → 不发语音」；不含消息原文。 */
  reason: z.string().max(80),
  implementation: tolerantEnum(PlannerImplementation),
  fallback: tolerantEnum(PlanningFallback).nullable(),
  latencyMs: z.number().int().nonnegative(),
  usageRecordId: Id.nullable(),
  createdAt: Timestamp,
});

export const PlannerAdminEndpoints = {
  getConfig: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ai/planner-config`,
    auth: 'admin',
    response: z.object({ items: z.array(PlannerConfigEntry) }),
    summary: '各决策类型当前使用的实现、模型、门槛（ADM-05 第 10 条）',
  }),
  updateConfig: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/admin/ai/planner-config/:decisionType`,
    auth: 'admin',
    params: z.object({ decisionType: PlanningDecisionType }),
    body: z.object({
      implementation: PlannerImplementation,
      modelKey: z.string().nullable(),
      confidenceThreshold: z.number().min(0.3).max(0.9),
      /** 切换实现时必填（PLAN-03 第 2 条）；只改门槛可为 null。 */
      evalReportId: z.string().trim().min(1).max(64).nullable(),
    }),
    response: PlannerConfigEntry,
    summary:
      '切换实现 / 改门槛；切换实现没有评测报告编号返回 400 bad_request（3.1 更正：bad_request 统一映射 400）；写审计',
  }),
  listDecisions: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/admin/ai/planning-decisions`,
    auth: 'admin',
    query: z.object({
      userId: Id.optional(),
      characterId: Id.optional(),
      decisionType: PlanningDecisionType.optional(),
      fallback: PlanningFallback.optional(),
      from: Timestamp.optional(),
      to: Timestamp.optional(),
      cursor: z.string().optional(),
    }),
    response: cursorPage(PlanningDecisionRecord),
    summary: '决策记录（保留 90 天，供抽查；不含消息内容）',
  }),
} as const;
