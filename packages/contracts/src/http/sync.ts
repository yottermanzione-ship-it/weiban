/**
 * realtime 模块：每用户更新日志与补拉。
 * 多端同步的核心，规则见 docs/architecture/message-reliability.md 第 4 节。
 * 每条更新带递增的 updateSeq；客户端记住处理到第几号，缺口或重连时按游标补拉。
 * 客户端遇到不认识的 type：记录游标后跳过，并在合适时机做一次全量重建。
 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, UpdateSeq, defineEndpoint } from '../common.js';
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
  data: z.object({ conversationId: Id, state: UserConversationState, unreadCount: z.number().int().nonnegative() }),
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

/** 设置类变化只通知「哪一块变了」，客户端重新拉取对应接口。 */
const SettingsUpdated = z.object({
  type: z.literal('settings.updated'),
  data: z.object({
    /** v0.2：model_credentials 删除（BYOK），新增 wallet（余额变化，客户端重新拉 GET /billing/wallet）。 */
    section: z.enum(['profile', 'notification', 'companion', 'model_selection', 'wallet']),
    characterId: Id.nullable(),
  }),
});

/** 模型可用状态变化（含余额不足 / 恢复），用于显示或撤掉系统横条（MDL-04）。 */
const ModelStatusUpdated = z.object({
  type: z.literal('model.status_updated'),
  data: z.object({ status: ModelStatus }),
});

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

export const UserUpdate = z.intersection(
  z.object({
    updateSeq: UpdateSeq,
    occurredAt: Timestamp,
  }),
  UserUpdatePayload,
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
    summary: '当前最新更新序号（全量重建后用它作为新游标）',
  }),
} as const;
