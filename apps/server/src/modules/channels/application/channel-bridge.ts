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
 * - 入站只认「这条绑定的对面账号本人」发来的消息，别人的消息一律拒绝（旧版 foreign_sender）。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_INBOUND_TEXT_MAX,
  type ChatReadPort,
  type ChatUserPort,
  type IdentityMembershipReadPort,
} from '@weiban/contracts';
import {
  CLOCK,
  ENVELOPE_CRYPTO,
  LOGGER,
  type Clock,
  type DbTx,
  type EnvelopeCrypto,
  type Logger,
} from '../../../platform/index.js';
import { CHAT_READ_PORT, CHAT_USER_PORT } from '../../chat/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import { ChannelStore, type BindingRow } from './channel-store.js';
import { isOwnPeer } from '../domain/peer.js';

export interface InboundInput {
  externalId: string;
  senderId: string;
  text: string;
  contextToken: string;
  createdAt: Date | null;
}

export type IngestOutcome = 'accepted' | 'duplicate' | 'rejected' | 'failed';

@Injectable()
export class ChannelBridge {
  constructor(
    @Inject(ChannelStore) private readonly store: ChannelStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_USER_PORT) private readonly chatUser: ChatUserPort,
  ) {}

  /**
   * 入站一条消息：入流水（幂等）→ 写进现有私聊（用户发言）→ 记结果。
   * 失败不抛：返回结果由 worker 记日志。重复投递返回 duplicate，不会产生两条聊天消息。
   */
  async ingest(binding: BindingRow, input: InboundInput): Promise<IngestOutcome> {
    if (binding.status !== 'active') return 'rejected';
    if (!input.externalId) return 'rejected';
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
    /**
     * 只认这条绑定对面那个人发的消息（isOwnPeer 是唯一判定处）。
     * 微信：ilink_user_id 扫码时就确认了，可信。
     * 微博：ws_token 只能证明 AppID 属于本人，证明不了私信者是谁 → 没有可信对面账号，
     *       所有 sender 都不匹配，入站全拒（通道也因此固定按「未联调」处理）。
     * 绝不能「谁最后发消息谁就是主人」：那等于任意私信者都能改绑、触发本人付费聊天并收到私密回复。
     */
    if (!isOwnPeer(binding.channel, binding.account_id, input.senderId)) {
      return reject('foreign_sender');
    }
    if (!binding.character_id) return reject('no_character');
    if (!(await this.membership.isProPlus(binding.user_id))) return reject('pro_required');
    const conversation = await this.chatRead.findDirectConversation(
      binding.user_id,
      binding.character_id,
    );
    if (!conversation) return reject('no_conversation');
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
    const binding = await this.store.activeBindingForCharacter(userId, event.senderRefId);
    if (!binding || binding.status !== 'active') return null;
    const message = await this.chatRead.getMessage(event.messageId, ['normal']);
    if (!message || message.content?.type !== 'text') return null;
    const text = String(message.content.text ?? '').trim();
    if (!text) return null;
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
    if (!outboundId) return null;
    return { outboundId, bindingId: binding.id };
  }
}
