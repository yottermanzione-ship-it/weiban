/**
 * 渠道 ↔ 现有聊天链路的桥（2026-10-25）。
 *
 * 入站：微信 / 微博的文字 → **以用户身份**写进现有私聊（ChatUserPort.sendMessage）→
 *       已有的 AI 回复、记忆、计费链路照常工作，渠道侧不需要另写一套回复逻辑。
 * 出站：订阅 chat.message_created，只挑「绑定角色在绑定的私聊里发的文字」排队，
 *       由 worker 发回微信 / 微博；一条聊天消息只发一次（binding_id + chat_message_id 唯一）。
 *
 * 边界：
 * - 只做文字。图片 / 语音 / 表情本轮不发到微信（契约与页面都如实写明），也不从微信取媒体。
 * - 成人范围（scope = adult）的正文**绝不**发到站外渠道：读取正文时只要 normal。
 * - 正文落库前用该用户 DEK 加密；解密只在本进程、只为了发送。
 * - 微信按扫码 peer；微博按助手凭据鉴权会话固定回信 peer，不从来信改写站内绑定者。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_INBOUND_TEXT_MAX,
  type ChatReadPort,
  type ChatUserPort,
  type IdentityMembershipReadPort,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  CLOCK,
  ENVELOPE_CRYPTO,
  LOGGER,
  type AppConfig,
  type Clock,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
} from '../../../platform/index.js';
import { CHAT_READ_PORT, CHAT_USER_PORT } from '../../chat/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { ChannelStore, type BindingRow } from './channel-store.js';
import { channelRuntimeConfig } from './channel-config.js';
import { hasChannelAccess } from './channel-access.js';
import { isOwnPeer } from '../domain/peer.js';
import { weiboPeerContextAad } from '../domain/weibo-openim.js';
import { QqSessionStore } from './qq-session-store.js';
import { qqAad, qqCodeHash, readQqPairingCode, QQ_REPLY_TTL_MS } from '../domain/qq-openapi.js';

export interface InboundInput {
  externalId: string;
  senderId: string;
  text: string;
  contextToken: string;
  createdAt: Date | null;
  /** 仅由完成 AppID/AppSecret 鉴权的微博 WSS runtime 提供，不是 HTTP 请求字段。 */
  weiboSession?: { bindingId: string; generation: number };
  qqSession?: { bindingId: string; generation: number };
}

export type IngestOutcome = 'accepted' | 'duplicate' | 'rejected' | 'failed';

@Injectable()
export class ChannelBridge {
  constructor(
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(QqSessionStore) private readonly qqStore: QqSessionStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_USER_PORT) private readonly chatUser: ChatUserPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 入站一条消息：入流水（幂等）→ 写进现有私聊（用户发言）→ 记结果。
   * 失败不抛：返回结果由 worker 记日志。重复投递返回 duplicate，不会产生两条聊天消息。
   */
  async ingest(candidate: BindingRow, input: InboundInput): Promise<IngestOutcome> {
    // 长连接无需因换角色重建；每次入站读取当前选择，同时拒绝旧凭据代际的迟到事件。
    const binding =
      candidate.channel === 'weibo' || candidate.channel === 'qq'
        ? await this.store.bindingById(candidate.id)
        : candidate;
    if (
      !binding ||
      binding.status !== 'active' ||
      binding.generation !== candidate.generation ||
      binding.user_id !== candidate.user_id
    )
      return 'rejected';
    // 纵深防御：即使库里还留着绑定行，只要这个渠道对**这个用户**不是 live（开关关了、被撤下白名单、
    // 或微博本来就没开放），就既不进聊天也不计费。
    if (
      channelRuntimeConfig(this.config, binding.channel, binding.user_id).integration !== 'live'
    ) {
      return 'rejected';
    }
    if (!input.externalId) return 'rejected';
    if (binding.channel === 'qq') {
      if (
        input.qqSession?.bindingId !== binding.id ||
        input.qqSession?.generation !== binding.generation ||
        !binding.context_token_sealed ||
        readQqPairingCode(input.text)
      )
        return 'rejected';
      const peer = await this.crypto.open(
        binding.user_id,
        qqAad(binding.id, 'peer'),
        binding.context_token_sealed,
      );
      try {
        if (peer.toString('utf8') !== input.senderId) return 'rejected';
      } finally {
        peer.fill(0);
      }
    }
    if (
      binding.channel === 'weibo' &&
      (input.weiboSession?.bindingId !== binding.id ||
        input.weiboSession?.generation !== binding.generation)
    )
      return 'rejected';
    const text = String(input.text ?? '')
      .trim()
      .slice(0, CHANNEL_INBOUND_TEXT_MAX);
    const now = this.clock.now();
    const textSealed = text
      ? await this.crypto.seal(
          binding.user_id,
          `channels:inbound:${binding.id}:${input.externalId}:text`,
          text,
        )
      : null;
    const contextTokenSealed = input.contextToken
      ? await this.crypto.seal(
          binding.user_id,
          `channels:inbound:${binding.id}:${input.externalId}:context`,
          input.contextToken,
        )
      : null;
    const row = await this.store.insertInbound({
      bindingId: binding.id,
      userId: binding.user_id,
      channel: binding.channel,
      externalMessageId: input.externalId,
      senderId: String(input.senderId ?? ''),
      textSealed,
      contextTokenSealed,
      messageCreatedAt: input.createdAt,
      now,
    });
    if (!row) return 'duplicate';

    const reject = async (reason: string): Promise<IngestOutcome> => {
      await this.store.finishInbound(row.id, 'rejected', reason, null, this.clock.now());
      return 'rejected';
    };

    if (!text) return reject('empty_text');
    // 微信按扫码确认的 peer；微博按助手专属凭据连接及固定回信上下文，不把 token.uid 当用户输入。
    if (binding.channel === 'wechat' && !isOwnPeer('wechat', binding.account_id, input.senderId)) {
      return reject('foreign_sender');
    }
    if (!binding.character_id) return reject('no_character');
    if (!(await hasChannelAccess(this.config, binding.channel, this.membership, binding.user_id)))
      return reject('pro_required');
    const conversation = await this.chatRead.findDirectConversation(
      binding.user_id,
      binding.character_id,
    );
    if (!conversation) return reject('no_conversation');
    if (conversation.contentScope !== 'normal') return reject('private_scope');
    if (binding.channel === 'weibo') {
      if (!input.senderId.trim()) return reject('empty_sender');
      const candidate = await this.crypto.seal(
        binding.user_id,
        weiboPeerContextAad(binding.id),
        input.senderId.trim(),
      );
      const selected = await this.store.pinWeiboPeer(
        binding.id,
        binding.generation,
        candidate,
        now,
      );
      if (!selected) return reject('stale_binding');
      const plaintext = await this.crypto.open(
        binding.user_id,
        weiboPeerContextAad(binding.id),
        selected,
      );
      try {
        if (!isOwnPeer('weibo', plaintext.toString('utf8'), input.senderId))
          return reject('foreign_sender');
      } finally {
        plaintext.fill(0);
      }
    }
    if (binding.channel === 'qq') {
      const expiresAt = new Date(
        Math.min(now.getTime(), input.createdAt?.getTime() ?? now.getTime()) + QQ_REPLY_TTL_MS,
      );
      if (expiresAt <= now) return reject('qq_reply_window_expired');
      const sealed = await this.crypto.seal(
        binding.user_id,
        qqAad(binding.id, 'reply'),
        input.externalId,
      );
      if (!(await this.qqStore.setReply(binding, sealed, expiresAt)))
        return reject('stale_binding');
    }
    try {
      const ack = await this.chatUser.sendMessage(binding.user_id, conversation.conversationId, {
        clientMsgId: row.clientMsgId,
        content: { type: 'text', text },
      });
      await this.store.finishInbound(
        row.id,
        'accepted',
        null,
        ack.message.messageId,
        this.clock.now(),
      );
      await this.store.touchEvent(binding.id, this.clock.now());
      return 'accepted';
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? 'send_failed';
      this.logger.warn(
        { err: error, channel: binding.channel, bindingId: binding.id, code },
        '渠道消息投递到聊天失败',
      );
      await this.store.finishInbound(row.id, 'failed', String(code), null, this.clock.now());
      return 'failed';
    }
  }

  /** 一次性配对只建立本人 peer，不作为聊天记录，不调用模型、记忆或计费。 */
  async pairQq(candidate: BindingRow, input: InboundInput): Promise<boolean> {
    if (
      candidate.channel !== 'qq' ||
      input.qqSession?.bindingId !== candidate.id ||
      input.qqSession?.generation !== candidate.generation
    )
      return false;
    const code = readQqPairingCode(input.text);
    if (!code || !input.senderId || !input.externalId) return false;
    const binding = await this.store.bindingById(candidate.id);
    if (
      !binding ||
      binding.channel !== 'qq' ||
      binding.status !== 'unbound' ||
      binding.generation !== candidate.generation ||
      binding.user_id !== candidate.user_id ||
      !binding.character_id
    )
      return false;
    if (
      channelRuntimeConfig(this.config, 'qq', binding.user_id).integration !== 'live' ||
      !(await hasChannelAccess(this.config, 'qq', this.membership, binding.user_id))
    )
      return false;
    const conversation = await this.chatRead.findDirectConversation(
      binding.user_id,
      binding.character_id,
    );
    if (!conversation || conversation.contentScope !== 'normal') return false;
    const now = this.clock.now();
    const expiresAt = new Date(
      Math.min(now.getTime(), input.createdAt?.getTime() ?? now.getTime()) + QQ_REPLY_TTL_MS,
    );
    if (expiresAt <= now) return false;
    const peer = await this.crypto.seal(binding.user_id, qqAad(binding.id, 'peer'), input.senderId);
    const reply = await this.crypto.seal(
      binding.user_id,
      qqAad(binding.id, 'reply'),
      input.externalId,
    );
    return this.qqStore.consume(
      binding,
      qqCodeHash(binding.id, binding.generation, code),
      peer,
      reply,
      expiresAt,
      now,
    );
  }

  /**
   * 角色在私聊里的文字 → 出站队列（同一事务，保证「有消息就有投递」）。
   * 只处理：私聊、发送者是角色、内容类型是文字、范围是 normal。
   */
  async enqueueCharacterReply(
    tx: DbTx,
    event: {
      conversationId: string;
      conversationType: 'direct' | 'group';
      messageId: string;
      senderKind: 'user' | 'character' | 'system';
      senderRefId: string | null;
      contentType: string;
      scope: 'normal' | 'adult';
      userRecipientIds: string[];
    },
  ): Promise<{ outboundId: string; bindingId: string } | null> {
    if (event.senderKind !== 'character') return null;
    if (event.conversationType !== 'direct') return null;
    if (event.scope !== 'normal') return null;
    if (event.contentType !== 'text') return null;
    if (!event.senderRefId) return null;
    const userId = event.userRecipientIds[0];
    if (!userId) return null;
    const bindings = await this.store.activeBindingsForCharacter(userId, event.senderRefId);
    const message = await this.chatRead.getMessage(event.messageId, ['normal']);
    if (!message || message.content?.type !== 'text') return null;
    const text = String(message.content.text ?? '').trim();
    if (!text) return null;
    let first: { outboundId: string; bindingId: string } | null = null;
    for (const binding of bindings) {
      if (
        binding.status !== 'active' ||
        channelRuntimeConfig(this.config, binding.channel, userId).integration !== 'live'
      )
        continue;
      const textSealed = await this.crypto.seal(
        userId,
        `channels:outbound:${binding.id}:${event.messageId}:text`,
        text,
        tx,
      );
      const outboundId = await this.store.enqueueOutbound(tx, {
        bindingId: binding.id,
        userId,
        channel: binding.channel,
        chatMessageId: event.messageId,
        textSealed,
        now: this.clock.now(),
      });
      if (outboundId) first ??= { outboundId, bindingId: binding.id };
    }
    return first;
  }
}
