/**
 * channels 模块的表（3.42，迁移 0139；2026-10-25 按真实旧协议重做）。
 *
 * 四张表：
 * - bindings         一个用户一个渠道最多一条；凭据与 context_token 都是该用户 DEK 加密的 bytea。
 * - bind_attempts    微信扫码会话（qrcode 能换 bot_token，所以加密）；bind_url 可直接下发客户端画二维码。
 * - inbound_messages 入站流水，(binding_id, external_message_id) 唯一做幂等；client_msg_id 是投递聊天的固定幂等键。
 * - outbound_messages 出站队列，(binding_id, chat_message_id) 唯一；失败按 next_attempt_at 重试。
 *
 * 表里没有任何明文密钥、明文正文；外部凭据只在进程内解密后立刻使用。
 */
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const channelsSchema = pgSchema('channels');

/** unbound / active / revoked；pending 不落库，由「存在未过期的绑定会话」推导。 */
export type BindingStatusValue = 'unbound' | 'active' | 'revoked';

export const bindings = channelsSchema.table(
  'bindings',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** wechat / weibo */
    channel: text('channel').notNull(),
    status: text('status').$type<BindingStatusValue>().notNull().default('unbound'),
    /** 出口角色（用户选的通讯录好友）。 */
    characterId: uuid('character_id'),
    characterName: text('character_name'),
    /** 对面账号 id（微信 ilink_user_id / 微博 uid）；解绑时清空。 */
    accountId: text('account_id'),
    accountName: text('account_name'),
    /** 微信 ilink_bot_id。 */
    botId: text('bot_id'),
    /** iLink 服务节点（白名单节点）；只有微信有。 */
    baseUrl: text('base_url').notNull().default(''),
    /** get_updates_buf 游标。 */
    cursor: text('cursor').notNull().default(''),
    /** 微信 bot_token，该用户 DEK 加密。 */
    botTokenSealed: bytea('bot_token_sealed'),
    /** 微博 AppID / AppSecret，该用户 DEK 加密。 */
    weiboAppIdSealed: bytea('weibo_app_id_sealed'),
    weiboAppSecretSealed: bytea('weibo_app_secret_sealed'),
    /** 最近一次入站 context_token（出站带上更稳），该用户 DEK 加密。 */
    contextTokenSealed: bytea('context_token_sealed'),
    /** 重绑计数：后台轮询任务带 generation，重建绑定后旧任务自动作废。 */
    generation: integer('generation').notNull().default(1),
    boundAt: tz('bound_at'),
    unboundAt: tz('unbound_at'),
    lastEventAt: tz('last_event_at'),
    lastPollAt: tz('last_poll_at'),
    lastError: text('last_error'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('bindings_user_channel_key').on(t.userId, t.channel),
    uniqueIndex('bindings_active_account_key')
      .on(t.channel, t.accountId)
      .where(sql`status = 'active' AND account_id IS NOT NULL`),
    index('bindings_active_idx')
      .on(t.channel, t.lastPollAt)
      .where(sql`status = 'active'`),
  ],
);

export type BindAttemptStatusValue =
  'creating' | 'wait' | 'scanned' | 'confirmed' | 'expired' | 'failed';

export const bindAttempts = channelsSchema.table(
  'bind_attempts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    channel: text('channel').notNull(),
    status: text('status').$type<BindAttemptStatusValue>().notNull().default('wait'),
    characterId: uuid('character_id').notNull(),
    characterName: text('character_name').notNull(),
    /** 微信 get_bot_qrcode 返回的 qrcode（能换 bot_token）→ 加密存。 */
    qrcodeSealed: bytea('qrcode_sealed').notNull(),
    /** 页面渲染二维码用的 liteapp 链接（不含 token）。 */
    bindUrl: text('bind_url').notNull(),
    pollBaseUrl: text('poll_base_url').notNull().default(''),
    expiresAt: tz('expires_at').notNull(),
    confirmedBindingId: uuid('confirmed_binding_id'),
    lastError: text('last_error'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    index('bind_attempts_user_idx').on(t.userId, t.channel, t.createdAt),
    uniqueIndex('bind_attempts_pending_key')
      .on(t.userId, t.channel)
      .where(sql`status IN ('creating','wait','scanned')`),
  ],
);

export type InboundOutcomeValue = 'pending' | 'accepted' | 'duplicate' | 'rejected' | 'failed';

export const inboundMessages = channelsSchema.table(
  'inbound_messages',
  {
    id: uuid('id').primaryKey(),
    bindingId: uuid('binding_id').notNull(),
    userId: uuid('user_id').notNull(),
    channel: text('channel').notNull(),
    externalMessageId: text('external_message_id').notNull(),
    senderId: text('sender_id').notNull(),
    textSealed: bytea('text_sealed'),
    contextTokenSealed: bytea('context_token_sealed'),
    /** 投递到聊天模块时用的幂等键（聊天模块要求 UUID）。 */
    clientMsgId: uuid('client_msg_id').notNull(),
    messageCreatedAt: tz('message_created_at'),
    outcome: text('outcome').$type<InboundOutcomeValue>().notNull().default('pending'),
    reason: text('reason'),
    chatMessageId: uuid('chat_message_id'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('inbound_messages_event_key').on(t.bindingId, t.externalMessageId),
    index('inbound_messages_user_idx').on(t.userId, t.createdAt),
  ],
);

export type OutboundStatusValue = 'pending' | 'sending' | 'sent' | 'retry' | 'failed' | 'skipped';

export const outboundMessages = channelsSchema.table(
  'outbound_messages',
  {
    id: uuid('id').primaryKey(),
    bindingId: uuid('binding_id').notNull(),
    userId: uuid('user_id').notNull(),
    channel: text('channel').notNull(),
    chatMessageId: uuid('chat_message_id').notNull(),
    textSealed: bytea('text_sealed').notNull(),
    status: text('status').$type<OutboundStatusValue>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tz('next_attempt_at').notNull(),
    lastError: text('last_error'),
    sentAt: tz('sent_at'),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('outbound_messages_chat_key').on(t.bindingId, t.chatMessageId),
    index('outbound_messages_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`status IN ('pending','retry')`),
  ],
);
