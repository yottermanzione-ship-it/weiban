/**
 * ai-runtime 模块对用户开放的「陪伴设置」：角色怎么回复我。
 * 数据归 ai-runtime（AI 系统负责人）所有；界面上与会话设置放在一起（CHAT-13）。
 * L1：秒回（CHAT-04）、拆条（CHAT-05）。
 * L2 起由 AI 负责人提出变更申请扩展：人设贴合度（CHAT-09）、情景模式（MODE，需经 policy）、
 * 主动消息开关与频率（CHAT-13 第 5 条）、主动来电开关、TA 的日常开关（SIM-13）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

export const CompanionSettings = z.object({
  /** 默认关闭秒回（CHAT-04 第 1 条）。 */
  instantReply: z.boolean(),
  /** 默认开启拆条（CHAT-05 第 1 条）。 */
  splitBubbles: z.boolean(),
  updatedAt: Timestamp,
});
export type CompanionSettings = z.infer<typeof CompanionSettings>;

export const UpdateCompanionSettingsRequest = CompanionSettings.omit({ updatedAt: true }).partial();

export const CompanionEndpoints = {
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
    response: CompanionSettings.extend({ inheritsDefaults: z.boolean() }),
    summary: '某个角色的陪伴设置（未单独设置时返回全局默认，inheritsDefaults = true）',
  }),
  updateForCharacter: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/characters/:characterId/companion-settings`,
    auth: 'user',
    params: z.object({ characterId: Id }),
    body: UpdateCompanionSettingsRequest,
    response: CompanionSettings.extend({ inheritsDefaults: z.boolean() }),
    summary: '修改某个角色的陪伴设置，从下一次回复起生效',
  }),
} as const;
