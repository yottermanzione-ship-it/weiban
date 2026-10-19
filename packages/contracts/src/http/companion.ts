/**
 * ai-runtime 模块对用户开放的「陪伴设置」：角色怎么回复我。
 * 数据归 ai-runtime（AI 系统负责人）所有；界面上与会话设置放在一起（CHAT-13）。
 * L1：秒回（CHAT-04）、拆条（CHAT-05）。
 * L2 起由 AI 负责人提出变更申请扩展：人设贴合度（CHAT-09）、情景模式（MODE，需经 policy）、
 * 主动消息开关与频率（CHAT-13 第 5 条）、主动来电开关、TA 的日常开关（SIM-13）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

/**
 * 情景模式（界面叫「情景预设」，docs/refactor/02 第 5 节）。
 * 3.2（换壳 UI 批次，次版本）新增 auto（自动）、treehole（树洞分享）、cheer（加油打气）三个可选值：
 * AI 策略未实现前，服务器按 daily（日常）处理回复；客户端照常显示和切换。
 * 客户端遇到不认识的值按 daily 显示（接收端容错）。
 */
export const ScenarioMode = z.enum([
  'daily',
  'tsundere',
  'romance',
  'adult',
  'auto',
  'treehole',
  'cheer',
]);
export type ScenarioMode = z.infer<typeof ScenarioMode>;

/**
 * 情景预设弹层的一项。服务器按弹层顺序返回（自动、日常聊天、情侣暧昧、树洞分享、傲娇斗嘴、加油打气、私密），
 * 只返回该角色（群聊：所有成员）有资格的项。3.2 新增的可选字段旧客户端忽略。
 */
export const ScenarioModeOption = z.object({
  id: ScenarioMode,
  /** 显示名（3.2 起：日常聊天 / 情侣暧昧 / 傲娇斗嘴 / 私密 等）。 */
  name: z.string(),
  /** 3.2：一句说明（「像朋友一样聊」）。 */
  description: z.string().optional(),
  /** 3.2：preset = 普通预设卡片；private = 弹层底部单独的「私密」一栏（成人内容）。 */
  section: z.enum(['preset', 'private']).optional(),
  /** 3.2：是否显示「推荐」角标（目前只有 auto）。 */
  recommended: z.boolean().optional(),
  /** 3.2：AI 是否已按该预设调整风格；false 表示暂按日常聊天回复（界面可照常显示）。 */
  aiReady: z.boolean().optional(),
});
export type ScenarioModeOption = z.infer<typeof ScenarioModeOption>;
export const ProactiveFrequency = z.enum(['low', 'medium', 'high']);
export const CompanionSettings = z.object({
  /** 默认关闭秒回（CHAT-04 第 1 条）。 */
  instantReply: z.boolean(),
  /** 默认开启拆条（CHAT-05 第 1 条）。 */
  splitBubbles: z.boolean(),
  updatedAt: Timestamp,
  /** 可选响应字段维持2.2客户端兼容，服务端始终返回实际值。 */
  personaFit: z.number().int().min(1).max(5).optional(),
  scenarioMode: ScenarioMode.optional(),
  proactiveMessages: z.boolean().optional(),
  proactiveFrequency: ProactiveFrequency.optional(),
  proactiveCalls: z.boolean().optional(),
  dailyLife: z.boolean().optional(),
  /** 3.0：该角色发语音、通话用的音色（MED-03 第 1 条，音色库见 GET /voices）；null = 用预设角色默认音色或平台默认。 */
  voiceId: Id.nullable().optional(),
  /**
   * 3.17（v5 批 B）：长上下文模式，只对单个角色设置、PRO+ 专属（docs/refactor/16 §5.4）。
   * 原文窗口从约 1 万 token 加大到约 10 万 token；非 PRO+ 打开返回 403 forbidden，会员到期后按关闭处理。
   * 全局默认不支持（传了忽略）。旧客户端不认识可忽略。
   */
  longContext: z.boolean().optional(),
});
export type CompanionSettings = z.infer<typeof CompanionSettings>;

export const UpdateCompanionSettingsRequest = CompanionSettings.omit({ updatedAt: true }).partial();

// 保留原生生成类既有必填参数顺序，新增可选参数追加到末尾。
const CharacterSettingsResponse = CompanionSettings.pick({
  instantReply: true,
  splitBubbles: true,
  updatedAt: true,
})
  .extend({ inheritsDefaults: z.boolean() })
  .extend(
    CompanionSettings.omit({ instantReply: true, splitBubbles: true, updatedAt: true }).shape,
  );

export const CompanionEndpoints = {
  listModes: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/scenario-modes`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: z.object({ items: z.array(ScenarioModeOption) }),
    summary: '仅返回该角色有资格显示的情景模式（情景预设），按弹层顺序',
  }),
  getDefaults: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/me/companion-defaults`,
    auth: 'user',
    response: CompanionSettings,
    summary: '全局默认陪伴设置',
  }),
  updateDefaults: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/me/companion-defaults`,
    auth: 'user',
    body: UpdateCompanionSettingsRequest,
    response: CompanionSettings,
    summary: '修改全局默认（不影响已单独设置过的角色）',
  }),
  getForCharacter: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/companion-settings`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    response: CharacterSettingsResponse,
    summary: '某个角色的陪伴设置（未单独设置时返回全局默认，inheritsDefaults = true）',
  }),
  updateForCharacter: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/characters/:characterId/companion-settings`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: UpdateCompanionSettingsRequest,
    response: CharacterSettingsResponse,
    summary: '修改某个角色的陪伴设置，从下一次回复起生效',
  }),
} as const;
