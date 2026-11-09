import { Inject, Injectable } from '@nestjs/common';
import type {
  ChatReadPort,
  ChatUserPort,
  ContactsReadPort,
  IdentityAccountStatusPort,
  IdentityMembershipReadPort,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  type AppConfig,
  type Clock,
  type Database,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { CHAT_READ_PORT, CHAT_USER_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_MEMBERSHIP_READ_PORT,
} from '../../identity/index.js';
import {
  LegacyEnvelope,
  LegacyRequest,
  legacyAuthAad,
  legacyMessageId,
  validLegacySignature,
} from '../domain/legacy-relay-protocol.js';
import { channelRuntimeConfig } from './channel-config.js';
import { hasChannelAccess } from './channel-access.js';

export interface LegacyBindingRow {
  id: string;
  channel: 'wechat' | 'weibo' | 'qq';
  legacy_binding_id: string;
  generation: number;
  user_id: string;
  character_id: string;
  conversation_id: string;
  peer_hash: string;
  persona_hash: string;
  auth_key_sealed: Buffer;
  enabled: boolean;
  after_seq: string;
  offered_seq: string;
  cutover_at: Date;
}

@Injectable()
export class LegacyRelayService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_USER_PORT) private readonly chatUser: ChatUserPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT) private readonly membership: IdentityMembershipReadPort,
  ) {}

  async handle(bindingId: string, raw: unknown): Promise<unknown> {
    const parsed = LegacyEnvelope.safeParse(raw);
    if (!parsed.success) throw new AppError('bad_request', '中继请求无效');
    const { rows } = await this.db.query<LegacyBindingRow>(
      'SELECT * FROM channels.legacy_bindings WHERE id=$1',
      [bindingId],
    );
    const binding = rows[0];
    if (!binding || !binding.enabled || binding.channel === 'weibo')
      throw new AppError('forbidden', '中继绑定不可用');
    let verified: boolean;
    const key = await this.crypto.open(
      binding.user_id,
      legacyAuthAad(binding.id),
      binding.auth_key_sealed,
    );
    try {
      verified = validLegacySignature(key, binding.id, parsed.data, this.clock.now().getTime());
    } finally {
      key.fill(0);
    }
    if (!verified) throw new AppError('unauthenticated', '中继签名无效或已过期');
    let input: LegacyRequest;
    try {
      input = LegacyRequest.parse(JSON.parse(parsed.data.payload));
    } catch {
      throw new AppError('bad_request', '中继请求无效');
    }
    if (input.generation !== binding.generation) throw new AppError('conflict', '中继绑定已变化');
    const conversation = await this.assertCurrent(binding);
    await this.assertEnabled(binding);

    if (input.op === 'status') return { enabled: true, generation: binding.generation };
    if (input.op === 'ingest') return this.ingest(binding, input);
    if (input.op === 'ack') {
      const result = await this.db.query(
        `UPDATE channels.legacy_bindings SET after_seq=GREATEST(after_seq,$3),updated_at=$4
         WHERE id=$1 AND generation=$2 AND enabled AND $3<=offered_seq`,
        [binding.id, binding.generation, input.throughSeq, this.clock.now()],
      );
      if (result.rowCount !== 1) throw new AppError('conflict', '中继游标无效');
      return { acknowledged: true };
    }

    const participant = conversation.participants.find(
      (p) => p.kind === 'character' && p.refId === binding.character_id,
    );
    if (!participant) throw new AppError('forbidden', '中继会话不可用');
    const page = await this.chatRead.readMessages({
      conversationId: binding.conversation_id,
      scopes: ['normal'],
      afterSeq: Number(binding.after_seq),
      limit: 50,
    });
    const throughSeq = page.reduce(
      (seq, message) => Math.max(seq, message.seq),
      Number(binding.after_seq),
    );
    const messages = page
      .filter(
        (message) =>
          message.status === 'normal' &&
          message.scope === 'normal' &&
          message.senderKind === 'character' &&
          message.senderParticipantId === participant.participantId &&
          message.content?.type === 'text' &&
          !message.labels?.some((label) => label === 'health' || label === 'quirk_draft'),
      )
      .map((message) => ({
        messageId: message.messageId,
        seq: message.seq,
        text: message.content?.type === 'text' ? message.content.text : '',
        createdAt: message.createdAt,
      }));
    if (throughSeq > Number(binding.offered_seq)) {
      const offered = await this.db.query(
        'UPDATE channels.legacy_bindings SET offered_seq=GREATEST(offered_seq,$2),updated_at=$3 WHERE id=$1 AND enabled',
        [binding.id, throughSeq, this.clock.now()],
      );
      if (offered.rowCount !== 1) throw new AppError('forbidden', '中继绑定已断开');
    }
    return { generation: binding.generation, throughSeq, messages };
  }

  private async assertEnabled(binding: LegacyBindingRow): Promise<void> {
    const current = await this.db.query(
      'SELECT 1 FROM channels.legacy_bindings WHERE id=$1 AND generation=$2 AND enabled',
      [binding.id, binding.generation],
    );
    if (!current.rowCount) throw new AppError('forbidden', '中继绑定已断开');
  }

  private async assertCurrent(binding: LegacyBindingRow) {
    if (
      channelRuntimeConfig(this.config, binding.channel, binding.user_id).integration !== 'live' ||
      !(await hasChannelAccess(this.config, binding.channel, this.membership, binding.user_id)) ||
      (await this.accounts.getAccountStatus(binding.user_id)) !== 'active' ||
      (await this.accounts.isBanned?.(binding.user_id)) ||
      !(await this.contacts.getActiveContact(binding.user_id, binding.character_id))
    )
      throw new AppError('forbidden', '中继绑定不可用');
    // Do not let two transport owners answer the same account/channel concurrently.
    const native = await this.db.query(
      "SELECT 1 FROM channels.bindings WHERE user_id=$1 AND channel=$2 AND status='active' LIMIT 1",
      [binding.user_id, binding.channel],
    );
    if (native.rowCount) throw new AppError('conflict', '新版已有渠道绑定，中继已暂停');
    const conversation = await this.chatRead.findDirectConversation(
      binding.user_id,
      binding.character_id,
    );
    if (
      !conversation ||
      conversation.conversationId !== binding.conversation_id ||
      conversation.type !== 'direct' ||
      conversation.contentScope !== 'normal' ||
      !conversation.participants.some((p) => p.kind === 'user' && p.refId === binding.user_id)
    )
      throw new AppError('forbidden', '中继会话不可用');
    return conversation;
  }

  private async ingest(binding: LegacyBindingRow, input: Extract<LegacyRequest, { op: 'ingest' }>) {
    if (input.peerHash !== binding.peer_hash) throw new AppError('forbidden', '中继发件人不匹配');
    const createdAt = new Date(input.createdAt);
    if (createdAt < binding.cutover_at || createdAt.getTime() > this.clock.now().getTime() + 60_000)
      throw new AppError('bad_request', '中继消息时间不在切换范围');
    const clientMsgId = legacyMessageId(binding.id, input.externalId);
    const aad = `channels:legacy-inbound:${clientMsgId}:text`;
    const sealed = await this.crypto.seal(binding.user_id, aad, input.text);
    await this.db.query(
      `INSERT INTO channels.inbound_messages
       (id,binding_id,user_id,channel,external_message_id,sender_id,text_sealed,client_msg_id,message_created_at,outcome,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$1,$8,'pending',$9,$9)
       ON CONFLICT (binding_id,external_message_id) DO NOTHING`,
      [
        clientMsgId,
        binding.id,
        binding.user_id,
        binding.channel,
        input.externalId,
        input.peerHash,
        sealed,
        createdAt,
        this.clock.now(),
      ],
    );
    const { rows } = await this.db.query<{
      text_sealed: Buffer;
      chat_message_id: string | null;
      outcome: string;
    }>(
      'SELECT text_sealed,chat_message_id,outcome FROM channels.inbound_messages WHERE id=$1 AND binding_id=$2',
      [clientMsgId, binding.id],
    );
    const receipt = rows[0];
    if (!receipt) throw new AppError('conflict', '中继消息键冲突');
    const original = await this.crypto.open(binding.user_id, aad, receipt.text_sealed);
    try {
      if (original.toString('utf8') !== input.text)
        throw new AppError('conflict', '中继消息键已使用');
    } finally {
      original.fill(0);
    }
    if (receipt.outcome === 'accepted')
      return { accepted: true, duplicate: true, messageId: receipt.chat_message_id };
    // This port is the ordinary user chat path: new-site authorization, AI and billing happen once.
    // On timeout/restart retry exactly this ID. Never invoke the old model or refund old quota here.
    await this.assertEnabled(binding);
    const ack = await this.chatUser.sendMessage(binding.user_id, binding.conversation_id, {
      clientMsgId,
      content: { type: 'text', text: input.text },
    });
    await this.db.query(
      "UPDATE channels.inbound_messages SET outcome='accepted',chat_message_id=$2,updated_at=$3 WHERE id=$1",
      [clientMsgId, ack.message.messageId, this.clock.now()],
    );
    return { accepted: true, duplicate: false, messageId: ack.message.messageId };
  }
}
