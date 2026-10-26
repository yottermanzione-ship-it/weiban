import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const seq = (name: string) => bigint(name, { mode: 'number' });
const time = (name: string) => timestamp(name, { withTimezone: true });
export const chatSchema = pgSchema('chat');
/** Per-target receipts: committed atomically with forwarded messages; cascade with target deletion. */
export const forwardReceipts = chatSchema.table(
  'forward_receipts',
  {
    userId: uuid('user_id').notNull(),
    requestId: uuid('request_id').notNull(),
    targetId: uuid('target_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    messageIds: uuid('message_ids').array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.requestId, t.targetId] })],
);
/** 产品的私聊/角色群都属于单个用户；不同用户与同一角色的会话完全隔离。 */
export const conversations = chatSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    type: text('type').notNull(),
    characterId: uuid('character_id'),
    title: text('title'),
    groupAvatarMediaId: uuid('group_avatar_media_id'),
    systemParticipantId: uuid('system_participant_id').notNull(),
    contentScope: text('content_scope').notNull().default('normal'),
    lastSeq: seq('last_seq').notNull().default(0),
    archivedAt: time('archived_at'),
    trialExpiresAt: time('trial_expires_at'),
    /** 拉群的角色（SOC-06）；用户建群与私聊为 null。 */
    createdByCharacterId: uuid('created_by_character_id'),
    /** 群名是否由用户 / 角色改过；false 时 title 是成员名拼接的快照。 */
    titleCustomized: boolean('title_customized').notNull().default(false),
    /** 建群幂等键（clientRequestId 或端口幂等键）。 */
    createKey: text('create_key'),
    createdAt: time('created_at').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('direct_user_character_idx').on(t.ownerUserId, t.characterId),
    index('conversations_owner_idx').on(t.ownerUserId),
    check('conversation_type', sql`${t.type} IN ('direct','group')`),
    check('conversation_scope', sql`${t.contentScope} IN ('normal','adult')`),
    check('conversation_seq', sql`${t.lastSeq} >= 0 AND ${t.lastSeq} <= 9007199254740991`),
  ],
);
export const participants = chatSchema.table(
  'participants',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    refId: uuid('ref_id').notNull(),
    joinedAt: time('joined_at').notNull(),
    readSeq: seq('read_seq').notNull().default(0),
    /** 群成员退出 / 被移出的时间；不为空即不再是成员（行保留用于渲染历史消息）。 */
    leftAt: time('left_at'),
  },
  (t) => [
    uniqueIndex('participant_ref_idx').on(t.conversationId, t.kind, t.refId),
    check('participant_kind', sql`${t.kind} IN ('user','character')`),
    check('participant_read_seq', sql`${t.readSeq} >= 0 AND ${t.readSeq} <= 9007199254740991`),
  ],
);
export const messages = chatSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: seq('seq').notNull(),
    senderParticipantId: uuid('sender_participant_id').notNull(),
    senderKind: text('sender_kind').notNull(),
    clientMsgId: text('client_msg_id').notNull(),
    contentCiphertext: bytes('content_ciphertext'),
    quoteMessageId: uuid('quote_message_id'),
    status: text('status').notNull().default('normal'),
    scope: text('scope').notNull(),
    /** 服务器端标签（如 health）：只有 ChatParticipantPort.postMessage 能设置，用户发送的消息恒为 null。 */
    labels: text('labels').array(),
    /** 明文内容类型（0030 起写入；旧消息为 null）。 */
    contentType: text('content_type'),
    /** action_card 上用户的选择（ADR-0026），只写一次。 */
    actionId: text('action_id'),
    actionChosenAt: time('action_chosen_at'),
    createdAt: time('created_at').notNull(),
    recalledAt: time('recalled_at'),
    /** v3.3（0088）：生成这条消息消耗的金额（微元，Message.pointsCost = ÷ 10,000）；没有扣费为 null。 */
    chargedMicros: bigint('charged_micros', { mode: 'number' }),
    /** v3.3（0088）：生成这条消息的那次调用（model-access 用量记录 ID）。 */
    usageRecordId: uuid('usage_record_id'),
  },
  (t) => [
    uniqueIndex('message_seq_idx').on(t.conversationId, t.seq),
    uniqueIndex('message_idempotency_idx').on(
      t.conversationId,
      t.senderParticipantId,
      t.clientMsgId,
    ),
    check('message_sender_kind', sql`${t.senderKind} IN ('user','character','system')`),
    check('message_scope', sql`${t.scope} IN ('normal','adult')`),
    check('message_status', sql`${t.status} IN ('normal','recalled')`),
    check('message_seq', sql`${t.seq} > 0 AND ${t.seq} <= 9007199254740991`),
  ],
);
export const userConversationStates = chatSchema.table(
  'user_conversation_states',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    pinned: boolean('pinned').notNull().default(false),
    muted: boolean('muted').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    clearedThroughSeq: seq('cleared_through_seq').notNull().default(0),
    readSeq: seq('read_seq').notNull().default(0),
    markedUnread: boolean('marked_unread').notNull().default(false),
    /**
     * 3.41：本人给这个会话单独设置的聊天背景（media.purpose = chat_background）；null = 默认背景。
     * 需要一条新迁移（0138）加列，见交接报告。
     */
    backgroundMediaId: uuid('background_media_id'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    check('state_read_seq', sql`${t.readSeq} >= 0 AND ${t.readSeq} <= 9007199254740991`),
    check(
      'state_cleared_seq',
      sql`${t.clearedThroughSeq} >= 0 AND ${t.clearedThroughSeq} <= 9007199254740991`,
    ),
  ],
);
export const hiddenMessages = chatSchema.table(
  'hidden_messages',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] })],
);
