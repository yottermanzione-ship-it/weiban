/**
 * realtime 模块：每用户更新日志与补拉。
 * 多端同步的核心，规则见 docs/architecture/message-reliability.md 第 4 节。
 * 每条更新带递增的 updateSeq；客户端记住处理到第几号，缺口或重连时按游标补拉。
 * 客户端遇到不认识的 type：契约把它解析为 type = 'unsupported'，客户端记录游标后跳过（Q-003）。
 * 所有更新都必须可以重复应用（幂等、带完整新状态），全量重建后的补拉依赖这一点（4.2 节）。
 */
import { z } from 'zod';
import {
  API_PREFIX,
  Id,
  Timestamp,
  UpdateSeq,
  defineEndpoint,
  tolerantEnum,
  unknownTypeFallback,
} from '../common.js';
import { Contact } from './contacts.js';
import { Conversation, Message, UserConversationState } from './chat.js';
import { ModelStatus } from './model-access.js';

const MessageCreated = z.object({
  type: z.literal('message.created'),
  data: z.object({ message: Message }),
});

const MessageRecalled = z.object({
  type: z.literal('message.recalled'),
  data: z.object({ conversationId: Id, messageId: Id, recalledAt: Timestamp }),
});

const MessageHidden = z.object({
  type: z.literal('message.hidden'),
  data: z.object({ conversationId: Id, messageId: Id }),
});

const ConversationCreated = z.object({
  type: z.literal('conversation.created'),
  data: z.object({ conversation: Conversation }),
});

/** 会话本身的变化：群名、成员、内容范围等。 */
const ConversationUpdated = z.object({
  type: z.literal('conversation.updated'),
  data: z.object({ conversation: Conversation }),
});

/** 当前用户的个人状态变化：已读、置顶、免打扰、隐藏、清空、标为未读。 */
const ConversationStateUpdated = z.object({
  type: z.literal('conversation.state_updated'),
  data: z.object({
    conversationId: Id,
    state: UserConversationState,
    unreadCount: z.number().int().nonnegative(),
  }),
});

/** 角色读到的位置变化（私聊「已读」小字）。 */
const ConversationPeerReadUpdated = z.object({
  type: z.literal('conversation.peer_read_updated'),
  data: z.object({ conversationId: Id, peerReadSeq: z.number().int().nonnegative() }),
});

const ContactUpserted = z.object({
  type: z.literal('contact.upserted'),
  data: z.object({ contact: Contact }),
});

const ContactRemoved = z.object({
  type: z.literal('contact.removed'),
  data: z.object({ characterId: Id }),
});

/**
 * 设置的分块。v0.2：model_credentials 删除（BYOK），新增 wallet（余额变化，客户端重新拉 GET /billing/wallet）。
 * v1.0：新增 preferences（界面偏好 / 主题，重新拉 GET /me/preferences）。
 * 新增分块是次版本变更；客户端不认识的分块解析为 'unsupported'，忽略即可。
 */
export const SettingsSection = z.enum([
  'profile',
  'notification',
  'companion',
  'model_selection',
  'wallet',
  'preferences',
]);
export type SettingsSection = z.infer<typeof SettingsSection>;

/** 设置类变化只通知「哪一块变了」，客户端重新拉取对应接口。 */
const SettingsUpdated = z.object({
  type: z.literal('settings.updated'),
  data: z.object({
    section: tolerantEnum(SettingsSection),
    characterId: Id.nullable(),
  }),
});

/** 模型可用状态变化（含余额不足 / 恢复），用于显示或撤掉系统横条（MDL-04）。 */
const ModelStatusUpdated = z.object({
  type: z.literal('model.status_updated'),
  data: z.object({ status: ModelStatus }),
});

/** 服务器写入更新日志时用的严格联合类型。 */
export const UserUpdatePayload = z.discriminatedUnion('type', [
  MessageCreated,
  MessageRecalled,
  MessageHidden,
  ConversationCreated,
  ConversationUpdated,
  ConversationStateUpdated,
  ConversationPeerReadUpdated,
  ContactUpserted,
  ContactRemoved,
  SettingsUpdated,
  ModelStatusUpdated,
]);
export type UserUpdatePayload = z.infer<typeof UserUpdatePayload>;

/** 当前契约版本认识的更新类型。 */
export const USER_UPDATE_TYPES = UserUpdatePayload.options.map((o) => o.shape.type.value);

/** 客户端不认识的更新类型：只推进游标，不做别的（服务器永远不会发出这个类型）。 */
export const UnsupportedUpdate = z.object({
  type: z.literal('unsupported'),
  data: z.object({ originalType: z.string() }),
});

/** 接收端的更新内容（Q-003）：已知类型严格校验，不认识的变成 UnsupportedUpdate。 */
export const ReceivedUserUpdatePayload = z.preprocess(
  unknownTypeFallback(USER_UPDATE_TYPES, (originalType) => ({
    type: 'unsupported',
    data: { originalType },
  })),
  z.discriminatedUnion('type', [...UserUpdatePayload.options, UnsupportedUpdate]),
);
export type ReceivedUserUpdatePayload = z.infer<typeof ReceivedUserUpdatePayload>;

/** 一条更新（补拉接口的元素、WebSocket update 帧的内容）。 */
export const UserUpdate = z.intersection(
  z.object({
    updateSeq: UpdateSeq,
    occurredAt: Timestamp,
  }),
  ReceivedUserUpdatePayload,
);
export type UserUpdate = z.infer<typeof UserUpdate>;

/** 更新日志保留天数；早于此的游标返回 410 sync_cursor_expired，客户端做全量重建。 */
export const USER_UPDATE_RETENTION_DAYS = 30;

export const SyncEndpoints = {
  getUpdates: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/sync/updates`,
    auth: 'user',
    query: z.object({
      since: z.coerce.number().int().nonnegative(),
      limit: z.coerce.number().int().min(1).max(500).default(500),
    }),
    response: z.object({
      items: z.array(UserUpdate),
      latestUpdateSeq: UpdateSeq,
      hasMore: z.boolean(),
    }),
    summary: '取 updateSeq 大于 since 的更新（升序）。游标过期返回 410 sync_cursor_expired',
  }),
  getState: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/sync/state`,
    auth: 'user',
    response: z.object({ latestUpdateSeq: UpdateSeq }),
    summary:
      '当前最新更新序号。全量重建时**第一步**调用，把结果记为重建起点 S；再拉会话、消息、通讯录、设置；' +
      '最后从 S 补拉，补上拉数据期间发生的更新（message-reliability.md 4.2 节，Q-002）',
  }),
} as const;
