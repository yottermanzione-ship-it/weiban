/**
 * chat 模块：会话、参与者、消息。
 * 需求：CHAT-01、CHAT-02、CHAT-03、CHAT-13（通用部分）；群聊（SOC-03）在 L4 扩展。
 * 可靠性规则见 docs/architecture/message-reliability.md。
 *
 * 重要：chat 不知道 AI 的存在。角色只是 kind = 'character' 的参与者。
 * 客户端遇到不认识的 content.type，必须显示「当前版本不支持此消息」而不是报错（新增消息类型是次版本变更）；
 * 契约用 ReceivedMessageContent 把它解析为 type = 'unsupported'。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  ClientMsgId,
  Id,
  NoContent,
  Seq,
  Timestamp,
  tolerantEnum,
  defineEndpoint,
  unknownTypeFallback,
} from '../common.js';

// ---------- 参与者 ----------

export const ParticipantKind = z.enum(['user', 'character']);
export type ParticipantKind = z.infer<typeof ParticipantKind>;

export const Participant = z.object({
  participantId: Id,
  kind: ParticipantKind,
  /** kind = user 时是 userId；kind = character 时是 characterId。 */
  refId: Id,
  joinedAt: Timestamp,
});
export type Participant = z.infer<typeof Participant>;

// ---------- 消息内容 ----------

export const TextContent = z.object({
  type: z.literal('text'),
  /** 文字与 emoji。 */
  text: z.string().min(1).max(4000),
});

/** 拍一拍（CHAT-02 第 4 条）。 */
export const NudgeContent = z.object({
  type: z.literal('nudge'),
  targetParticipantId: Id,
});

/**
 * 系统提示（会话中的灰色小字，术语见 glossary）。
 * code 决定文案模板，客户端按 code 渲染；params 填充模板。
 * L1 使用：contact_accepted（XX 通过了你的好友申请）。
 * 后续层预留：scenario_mode_switched、familiarity_level_up、member_joined、member_left、group_renamed、
 * missed_call、call_record 等，新增 code 属于次版本变更。
 */
export const SystemContent = z.object({
  type: z.literal('system'),
  code: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});

/**
 * L1 的消息内容（严格）：服务器写入消息时用它校验。
 * 图片、语音、表情包、链接、名片、通话记录在 L4/L5 由架构扩展（新增类型是次版本变更）。
 */
export const MessageContent = z.discriminatedUnion('type', [
  TextContent,
  NudgeContent,
  SystemContent,
]);
export type MessageContent = z.infer<typeof MessageContent>;

/** 当前契约版本认识的消息类型。 */
export const MESSAGE_CONTENT_TYPES = MessageContent.options.map((o) => o.shape.type.value);

/**
 * 客户端不认识的消息类型（新版本服务器发来的新类型）：显示「当前版本不支持此消息」。
 * 这个类型只由接收端解析产生，服务器永远不会发出 type = 'unsupported'。
 */
export const UnsupportedContent = z.object({
  type: z.literal('unsupported'),
  /** 服务器发来的原始类型名，例 "image"。 */
  originalType: z.string(),
});
export type UnsupportedContent = z.infer<typeof UnsupportedContent>;

/**
 * 接收端的消息内容（Q-003）：已知类型照常严格校验；不认识的类型变成 UnsupportedContent，不报错。
 * 出现在所有「服务器 → 客户端」的消息里（Message.content）。
 */
export const ReceivedMessageContent = z.preprocess(
  unknownTypeFallback(MESSAGE_CONTENT_TYPES, (originalType) => ({
    type: 'unsupported',
    originalType,
  })),
  z.discriminatedUnion('type', [TextContent, NudgeContent, SystemContent, UnsupportedContent]),
);
export type ReceivedMessageContent = z.infer<typeof ReceivedMessageContent>;

/** 用户可以发送的内容（不能发系统提示）。 */
export const UserSendableContent = z.discriminatedUnion('type', [TextContent, NudgeContent]);
export type UserSendableContent = z.infer<typeof UserSendableContent>;

// ---------- 消息 ----------

/** 内容范围：由服务器按会话当时的 contentScope 盖章，客户端不能指定（hard-boundaries.md「内容范围标签」）。 */
export const ContentScope = z.enum(['normal', 'adult']);
export type ContentScope = z.infer<typeof ContentScope>;

export const MessageStatus = z.enum(['normal', 'recalled']);

export const QuoteRef = z.object({
  messageId: Id,
  seq: Seq,
  /** 被引用消息的摘要（被撤回时为 null）。 */
  preview: z.string().max(100).nullable(),
});

export const Message = z.object({
  messageId: Id,
  conversationId: Id,
  seq: Seq,
  senderParticipantId: Id,
  senderKind: ParticipantKind.or(z.literal('system')),
  /** 撤回后为 null（与微信一致，看不到撤回内容）。客户端解析时不认识的类型变为 unsupported。 */
  content: ReceivedMessageContent.nullable(),
  quote: QuoteRef.nullable(),
  status: MessageStatus,
  scope: ContentScope,
  /** 仅当发送者是当前用户时返回，用于与本地「发送中」的消息合并。 */
  clientMsgId: ClientMsgId.nullable(),
  createdAt: Timestamp,
  recalledAt: Timestamp.nullable(),
});
export type Message = z.infer<typeof Message>;

/** 会话列表中的最后一条消息摘要。成人范围消息是否显示为「[消息]」以 PRD v1.2 为准。 */
export const MessagePreview = z.object({
  messageId: Id,
  seq: Seq,
  senderParticipantId: Id,
  text: z.string().max(100),
  createdAt: Timestamp,
});

// ---------- 会话 ----------

export const ConversationType = z.enum(['direct', 'group']);
export type ConversationType = z.infer<typeof ConversationType>;

/** 当前用户对这个会话的个人状态（置顶、免打扰等，CHAT-01、CHAT-13）。 */
export const UserConversationState = z.object({
  pinned: z.boolean(),
  muted: z.boolean(),
  /** 从会话列表删除；收到新消息时自动恢复（CHAT-01 第 2 条）。 */
  hidden: z.boolean(),
  /** 清空聊天记录：seq 小于等于此值的消息不再显示（CHAT-13 第 8 条）；0 表示未清空。 */
  clearedThroughSeq: z.number().int().nonnegative(),
  /** 我读到的位置；未读数 = lastSeq - readSeq（不计我自己发的消息，服务器计算）。 */
  readSeq: z.number().int().nonnegative(),
  /** 用户手动「标为未读」；进入会话或标记已读后自动清除。 */
  markedUnread: z.boolean(),
});
export type UserConversationState = z.infer<typeof UserConversationState>;

export const Conversation = z.object({
  conversationId: Id,
  type: ConversationType,
  /** 群名；私聊为 null（客户端显示角色名或备注）。 */
  title: z.string().max(40).nullable(),
  participants: z.array(Participant),
  contentScope: ContentScope,
  lastSeq: z.number().int().nonnegative(),
  lastMessage: MessagePreview.nullable(),
  state: UserConversationState,
  unreadCount: z.number().int().nonnegative(),
  /** 私聊：角色读到的位置，用于显示「已读」（CHAT-07）；群聊为 null（群聊不显示已读）。 */
  peerReadSeq: z.number().int().nonnegative().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Conversation = z.infer<typeof Conversation>;

// ---------- 请求 ----------

export const SendMessageRequest = z.object({
  clientMsgId: ClientMsgId,
  content: UserSendableContent,
  quoteMessageId: Id.nullable().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/** 送达确认：已送达 = 服务器已存好并分配了 seq。 */
export const MessageAck = z.object({
  clientMsgId: ClientMsgId,
  message: Message,
});
export type MessageAck = z.infer<typeof MessageAck>;

export const ListMessagesQuery = z
  .object({
    /** 取 seq 大于此值的消息（向新的方向，补拉用）。 */
    afterSeq: z.coerce.number().int().nonnegative().optional(),
    /** 取 seq 小于此值的消息（向旧的方向，上滑加载历史用）。 */
    beforeSeq: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => !(q.afterSeq !== undefined && q.beforeSeq !== undefined), {
    message: 'afterSeq 与 beforeSeq 不能同时使用',
  });

export const UpdateConversationStateRequest = z.object({
  pinned: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
});

// ---------- 接口 ----------

export const ConversationParams = z.object({ conversationId: Id });
export const MessageParams = z.object({ conversationId: Id, messageId: Id });

/** 分页实际检查的seq范围；排除区间是已隐藏/清空的负记录，不含正文。 */
export const MessagePageCoverage = z
  .object({
    fromSeq: z.number().int().nonnegative(),
    throughSeq: z.number().int().nonnegative(),
    excludedRanges: z
      .array(
        z.object({
          fromSeq: Seq,
          throughSeq: Seq,
          reason: tolerantEnum(z.enum(['hidden', 'cleared'])),
        }),
      )
      .max(200),
  })
  .superRefine((value, ctx) => {
    if (value.fromSeq > value.throughSeq || (value.fromSeq === 0 && value.throughSeq !== 0))
      ctx.addIssue({ code: 'custom', message: '扫描范围必须有序；空范围为0/0' });
    if (value.throughSeq - value.fromSeq + 1 > 200)
      ctx.addIssue({ code: 'custom', message: '单页最多扫描200个seq' });
    for (const range of value.excludedRanges)
      if (
        range.fromSeq > range.throughSeq ||
        range.fromSeq < value.fromSeq ||
        range.throughSeq > value.throughSeq
      )
        ctx.addIssue({ code: 'custom', message: '排除区间必须位于扫描范围内' });
  });
export type MessagePageCoverage = z.infer<typeof MessagePageCoverage>;
export const MessagePage = z.object({
  items: z.array(Message),
  hasMore: z.boolean(),
  /** 2.1新增；旧客户端忽略，新同步引擎用它避免对合法空洞无限补拉。 */
  coverage: MessagePageCoverage.optional(),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const ChatEndpoints = {
  listConversations: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations`,
    auth: 'user',
    response: z.object({ items: z.array(Conversation) }),
    summary: '会话列表（全量；增量变化走同步更新）。客户端排序：置顶在前，其余按最后消息时间倒序',
  }),
  getConversation: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId`,
    auth: 'user',
    params: ConversationParams,
    response: Conversation,
    summary: '单个会话',
  }),
  listMessages: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/conversations/:conversationId/messages`,
    auth: 'user',
    params: ConversationParams,
    query: ListMessagesQuery,
    response: MessagePage,
    summary: '按 seq 分页取消息（结果按 seq 升序）；不返回已被本人删除或已清空的消息',
  }),
  sendMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages`,
    auth: 'user',
    params: ConversationParams,
    body: SendMessageRequest,
    response: MessageAck,
    summary:
      '发送消息（WebSocket 不可用时的等价路径）。同一 clientMsgId 重复提交返回同一条消息（幂等）',
  }),
  recallMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages/:messageId/recall`,
    auth: 'user',
    params: MessageParams,
    response: Message,
    summary: '撤回自己的消息，限 P-23 时间内（CHAT-02 第 3 条）。超时 422 recall_window_expired',
  }),
  hideMessage: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/messages/:messageId/hide`,
    auth: 'user',
    params: MessageParams,
    response: NoContent,
    summary: '删除消息：只从本人视图删除（本人所有设备同步），角色记忆不受影响',
  }),
  markRead: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/read`,
    auth: 'user',
    params: ConversationParams,
    body: z.object({ readSeq: Seq }),
    response: NoContent,
    summary: '标记已读到某条（只前进不后退）',
  }),
  markUnread: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/unread`,
    auth: 'user',
    params: ConversationParams,
    response: NoContent,
    summary: '标为未读（CHAT-01 第 2 条）',
  }),
  updateState: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/conversations/:conversationId/state`,
    auth: 'user',
    params: ConversationParams,
    body: UpdateConversationStateRequest,
    response: UserConversationState,
    summary: '置顶、免打扰、从列表删除',
  }),
  clearHistory: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/conversations/:conversationId/clear`,
    auth: 'user',
    params: ConversationParams,
    response: UserConversationState,
    summary: '清空聊天记录（只删显示，记忆和养成保留，CHAT-13 第 8 条）',
  }),
} as const;
