/**
 * 小V同学官方身份（方向 B）：表面是普通联系人、里子是官方服务号。
 * 官方身份不是角色库里的角色：没有 characters 行、不进广场、不占通讯录名额（Q1 占位问题待确认），
 * 会话以 conversations.official_identity_key 标记、参与者 kind = 'official'。
 *
 * 固定键与固定 refId 永不更换：会话按 identityKey 查找、参与者按 refId 认身份，
 * 换键即丢历史会话关联。名字只用「小V同学」（语音转写的小薇/小微/小魏均为同一人）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, defineEndpoint } from '../common.js';

/** 官方身份固定键（conversations.official_identity_key 的唯一取值）。 */
export const OFFICIAL_IDENTITY_KEY = 'official:xiaov';

/**
 * 官方参与者的固定 refId。合成值、不是任何真实用户或角色的 ID；
 * 绝不能拿它去查 characters / identity，也不能把它当 characterId 传给任何角色端口。
 */
export const OFFICIAL_REF_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

export const OFFICIAL_NAME = '小V同学';

/**
 * 官方服务号资料（客户端拿到的是这个对象，不是角色资料）。
 * 头像沿用与否待确认（Q1 待确认项）：当前 avatarPath 为 null，客户端用内置官方头像占位，
 * 不得拿角色头像接口给它换头像。
 */
export const OfficialProfile = z.object({
  kind: z.literal('official'),
  identityKey: z.literal(OFFICIAL_IDENTITY_KEY),
  refId: z.literal(OFFICIAL_REF_ID),
  name: z.literal(OFFICIAL_NAME),
  /** 沿用旧版签名。 */
  signature: z.string(),
  /** null = 客户端用内置官方头像占位。 */
  avatarPath: z.string().nullable(),
});
export type OfficialProfile = z.infer<typeof OfficialProfile>;

/** 通讯录里的合成官方联系人：只供展示与排序，不写 contacts 行。 */
export const OfficialContact = z.object({
  kind: z.literal('official'),
  refId: z.literal(OFFICIAL_REF_ID),
  name: z.literal(OFFICIAL_NAME),
  signature: z.string(),
  avatarPath: z.string().nullable(),
  /** 尚未补齐会话时为 null；客户端点开时调 ensure 补齐。 */
  conversationId: Id.nullable(),
});
export type OfficialContact = z.infer<typeof OfficialContact>;

/** 公告群发受众：受众规则待定，只接受显式用户列表；all_users 保留形状、服务端拒绝。 */
export const OfficialBroadcastAudience = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_ids'), userIds: z.array(Id).min(1).max(500) }),
  z.object({ kind: z.literal('all_users') }),
]);
export type OfficialBroadcastAudience = z.infer<typeof OfficialBroadcastAudience>;

export const OfficialBroadcastRequest = z.object({
  /** 调用方生成的广播 ID：同一 ID 重复提交只发一次（按用户逐条幂等）。 */
  broadcastId: Id,
  title: z.string().trim().min(1).max(40).optional(),
  body: z.string().trim().min(1).max(2000),
  audience: OfficialBroadcastAudience,
});
export type OfficialBroadcastRequest = z.infer<typeof OfficialBroadcastRequest>;

export const OfficialBroadcastResponse = z.object({
  broadcastId: Id,
  /** 实际发出条数（去重后）。 */
  delivered: z.number().int().nonnegative(),
  /** 账号失效等原因跳过的人数。 */
  skipped: z.number().int().nonnegative(),
});
export type OfficialBroadcastResponse = z.infer<typeof OfficialBroadcastResponse>;

export const OfficialAssistantEndpoints = {
  getProfile: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/official-assistant/profile`,
    auth: 'user',
    response: OfficialProfile,
    summary: '小V同学官方服务号资料（名字/签名/头像占位），不是角色资料',
  }),
  getContact: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/official-assistant/contact`,
    auth: 'user',
    response: OfficialContact,
    summary: '通讯录合成官方联系人（不写 contacts 行）；客户端按名排序、不置顶',
  }),
  ensureConversation: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/official-assistant/conversation`,
    auth: 'user',
    response: z.object({ conversationId: Id }),
    summary:
      '补齐官方会话（幂等）：新用户默认有、老用户自动补；首次创建时发一条欢迎语，之后不再重发',
  }),
} as const;

export const OfficialAssistantAdminEndpoints = {
  broadcast: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/admin/official-assistant/broadcast`,
    auth: 'admin',
    body: OfficialBroadcastRequest,
    response: OfficialBroadcastResponse,
    summary:
      '公告群发：以小V同学名义向显式用户列表各发一条；默认关闭（OFFICIAL_ASSISTANT_BROADCAST_ENABLED），全量受众待定、服务端拒绝',
  }),
} as const;
