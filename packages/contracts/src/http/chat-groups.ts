/**
 * chat 模块 3.0 扩展（L4～L6，T-062）：群聊（SOC-03）、消息卡片按钮（ADR-0026）、聊天记录搜索（CHAT-12，ADR-0027）。
 * 数据归 chat。chat 仍不知道 AI：角色拉群（SOC-06）由 ai-runtime 经 ChatAdminPort.createGroupConversation 完成。
 * 群聊的回复节奏、「角色自己聊天」、情景模式属于陪伴设置，归 ai-runtime（http/companion.ts GroupCompanionEndpoints）。
 */
import { z } from 'zod';
import { API_PREFIX, Id, LocalDate, NoContent, Seq, Timestamp, defineEndpoint } from '../common.js';
import { Conversation, Message, ParticipantKind } from './chat.js';

/** 群里角色成员上限（P-21：9 个角色 + 用户）。 */
export const GROUP_MEMBER_LIMIT = 9 as const;
/** 建群最少角色数（SOC-03 第 1 条）。 */
export const GROUP_MIN_CHARACTERS = 2 as const;

// ---------- 群聊 ----------

export const CreateGroupRequest = z.object({
  /** 幂等：同一 clientRequestId 重复提交返回同一个群。 */
  clientRequestId: Id,
  /** 必须都是本人通讯录中 active 的角色，2～P-21 个，不重复。 */
  characterIds: z.array(Id).min(GROUP_MIN_CHARACTERS).max(GROUP_MEMBER_LIMIT),
  /** 不传或 null：默认按成员名拼接（SOC-03 第 2 条）。 */
  title: z.string().trim().min(1).max(40).nullable().optional(),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequest>;

export const GroupParams = z.object({ conversationId: Id });

export const ChatGroupEndpoints = {
  createGroup: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/groups`,
    auth: 'user',
    body: CreateGroupRequest,
    response: Conversation,
    summary:
      '发起群聊（SOC-03 第 1 条），成功 201；超过 P-21 返回 422 limit_reached。群里写系统提示 group_created；' +
      '发出 chat.conversation_created 与 chat.group_members_changed',
  }),
  renameGroup: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/groups/:conversationId`,
    auth: 'user',
    params: GroupParams,
    /** 3.0.1：传空字符串或 null 表示恢复默认名（成员名拼接，之后随成员变化自动更新）。 */
    body: z.object({ title: z.string().trim().max(40).nullable() }),
    response: Conversation,
    summary:
      '修改群名，群里写系统提示 group_renamed（恢复默认名时 params.reset = true）；私聊返回 422 not_group_conversation',
  }),
  addMembers: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/groups/:conversationId/members`,
    auth: 'user',
    params: GroupParams,
    body: z.object({ characterIds: z.array(Id).min(1).max(GROUP_MEMBER_LIMIT) }),
    response: Conversation,
    summary:
      '拉角色进群（「+」）。新成员不具备当前情景模式资格时，ai-runtime 订阅 chat.group_members_changed 把群切回日常并写系统提示（SOC-03 第 4 条）',
  }),
  removeMember: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/groups/:conversationId/members/:characterId`,
    auth: 'user',
    params: z.object({ conversationId: Id, characterId: Id }),
    response: Conversation,
    summary:
      '移出角色（「−」），群里写系统提示 member_removed（SOC-03 第 5 条）；少于 1 个角色时群仍保留',
  }),
  dissolveGroup: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/groups/:conversationId/dissolve`,
    auth: 'user',
    params: GroupParams,
    response: NoContent,
    summary:
      '删除并退出（用户退出即解散，SOC-03 第 3 条）：会话与消息物理删除，发出 chat.group_dissolved；拉群者可在私聊中提起一次（SOC-06 第 3 条）',
  }),
} as const;

// ---------- 消息卡片按钮 ----------

export const ChatActionEndpoints = {
  chooseMessageAction: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages/:messageId/action`,
    auth: 'user',
    params: z.object({ conversationId: Id, messageId: Id }),
    body: z.object({ actionId: z.string().regex(/^[a-z0-9_]{1,32}$/) }),
    response: Message,
    summary:
      '点卡片消息的按钮（ADR-0026）。只能点一次，再点返回 409 action_already_chosen；同一 actionId 重复提交返回原结果（幂等）。' +
      '写 Message.actionChoice、发 message.updated 更新与 chat.message_action_chosen 事件',
  }),
} as const;

// ---------- 聊天记录搜索（CHAT-12，ADR-0027） ----------

/** 搜索关键词：去掉首尾空白后 1～50 字。 */
export const SearchKeyword = z.string().trim().min(1).max(50);

/** 一条命中的消息。snippet 是命中处前后各约 20 字的摘录，关键词位置由客户端自行高亮。 */
export const MessageSearchHit = z.object({
  conversationId: Id,
  messageId: Id,
  seq: Seq,
  senderParticipantId: Id,
  senderKind: ParticipantKind.or(z.literal('system')),
  snippet: z.string().max(120),
  createdAt: Timestamp,
});
export type MessageSearchHit = z.infer<typeof MessageSearchHit>;

/** 全局搜索中每个会话的命中汇总（「N 条相关聊天记录」）。 */
export const ConversationSearchGroup = z.object({
  conversationId: Id,
  matchCount: z.number().int().positive(),
  /** 最新的一条命中；matchCount = 1 时客户端直接显示它。 */
  latestHit: MessageSearchHit,
});

export const GlobalSearchResult = z.object({
  /** 通讯录中名字 / 备注命中的角色（客户端用本地通讯录渲染）。 */
  characterIds: z.array(Id).max(20),
  /** 群名命中的群聊。 */
  groupConversationIds: z.array(Id).max(20),
  messages: z.array(ConversationSearchGroup).max(20),
});
export type GlobalSearchResult = z.infer<typeof GlobalSearchResult>;

export const ChatSearchEndpoints = {
  searchAll: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/search`,
    auth: 'user',
    query: z.object({ q: SearchKeyword }),
    response: GlobalSearchResult,
    summary:
      '全局搜索：角色、群聊、聊天记录（CHAT-12）。只搜文字类内容（文字、链接标题、信件、每日一问、角色语音原文），' +
      '不含已撤回、本人已删除、已清空的消息',
  }),
  searchConversation: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/search`,
    auth: 'user',
    params: z.object({ conversationId: Id }),
    query: z.object({
      q: SearchKeyword,
      /** 取 seq 小于此值的命中（向旧翻页）。 */
      beforeSeq: z.coerce.number().int().positive().optional(),
      /** 3.1（积压 ㉘）：只看某位成员发的（群成员筛选）。 */
      senderParticipantId: Id.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
    response: z.object({ items: z.array(MessageSearchHit), hasMore: z.boolean() }),
    summary:
      '会话内搜索（群聊信息页「查找聊天记录」），结果按 seq 倒序；点击后用 listMessages 定位上下文',
  }),
  /**
   * 3.1（积压 ㉘）：按日期定位（会话内查找「日期」）。date 按用户时区解释，返回这一天及之后第一条可见消息的 seq；
   * 之后没有消息时为 null。客户端拿到 seq 后用 listMessages（beforeSeq = seq + 1 与 afterSeq = seq - 1）取上下文。
   */
  locateByDate: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/messages/locate`,
    auth: 'user',
    params: z.object({ conversationId: Id }),
    query: z.object({ date: LocalDate }),
    response: z.object({ seq: Seq.nullable() }),
    summary: '3.1：按日期定位到当天第一条消息（CHAT-12 会话内查找「日期」）',
  }),
  /**
   * 3.1（积压 ㉘）：按类型 / 发送者列出（会话内查找「图片 / 链接」、群成员筛选）。结果按 seq 倒序，
   * 不返回已撤回、本人已删除、已清空的消息；不受「只搜文字类」限制。
   */
  listByType: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/messages/by-type`,
    auth: 'user',
    params: z.object({ conversationId: Id }),
    query: z
      .object({
        contentType: z.enum(['image', 'link', 'voice', 'sticker']).optional(),
        senderParticipantId: Id.optional(),
        beforeSeq: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .refine((q) => q.contentType !== undefined || q.senderParticipantId !== undefined, {
        message: 'contentType 与 senderParticipantId 至少传一个',
      }),
    response: z.object({ items: z.array(Message), hasMore: z.boolean() }),
    summary: '3.1：按消息类型 / 发送者列出（图片、链接；只看某人）',
  }),
} as const;
