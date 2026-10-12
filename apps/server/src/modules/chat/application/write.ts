import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  ClientMsgId,
  Id,
  MessageContent,
  type Message,
  type PostMessageInput,
  type PostMessageError,
  type PortResult,
  type PolicyPort,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  ENVELOPE_CRYPTO,
  OUTBOX,
  newId,
  parseContract,
  type Clock,
  type DbTx,
  type EnvelopeCrypto,
  type Outbox,
} from '../../../platform/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import {
  MEDIA_READ_PORT,
  MEDIA_SYSTEM_PORT,
  MEDIA_STICKER_CHECK,
  type MediaReadPort,
  type MediaStickerCheck,
  type MediaSystemPort,
} from '../../media/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  conversations,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
import { ChatStore, type ConversationRow } from './store.js';

const LABEL_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** 去重、排序、过滤非法值；最多 8 个。chat 不理解标签含义，只负责存与下发。 */
export function normalizeLabels(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const v of input) if (typeof v === 'string' && LABEL_PATTERN.test(v)) set.add(v);
  return [...set].sort().slice(0, 8);
}

@Injectable()
export class ChatWriteService {
  constructor(
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(MEDIA_STICKER_CHECK) private readonly stickers: MediaStickerCheck,
    @Inject(MEDIA_READ_PORT) private readonly mediaRead: MediaReadPort,
  ) {}
  async post(
    tx: DbTx,
    row: ConversationRow,
    input: PostMessageInput,
    senderKind?: 'system',
  ): Promise<PortResult<Message, PostMessageError>> {
    let content = parseContract(MessageContent, input.content);
    // labels 只接受服务器端发送方传入（participant 端口）；用户经 HTTP / WebSocket 发送时由 user.ts 构造输入，不会带上。
    const labels = normalizeLabels(input.labels);
    const idempotencyKey = input.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(idempotencyKey))
      throw new AppError('bad_request', '消息幂等键不正确');
    parseContract(Id, input.senderParticipantId);
    if (row.archivedAt)
      return { ok: false, error: 'not_conversation_member', message: '请先重新添加好友' };
    if (row.trialExpiresAt && row.trialExpiresAt <= this.clock.now())
      return { ok: false, error: 'not_conversation_member', message: '这次试聊已结束' };
    const [sender] = await tx.db
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.id, input.senderParticipantId),
          eq(participants.conversationId, row.id),
        ),
      );
    if (sender?.kind === 'user') parseContract(ClientMsgId, idempotencyKey);
    // 已退出 / 被移出群的角色不能再发言（幂等重试也不行，避免迟到的 AI 回复进群）。
    if (sender?.leftAt)
      return { ok: false, error: 'not_conversation_member', message: '发送者已不在此群聊中' };
    const system = senderKind === 'system' && input.senderParticipantId === row.systemParticipantId;
    if (!sender && !system)
      return { ok: false, error: 'not_conversation_member', message: '发送者不在此会话中' };
    if ((content.type === 'system') !== system)
      return { ok: false, error: 'invalid_content', message: '不能以该身份发送系统消息' };
    const view = await this.store.view(tx, row, row.ownerUserId);
    const [existing] = await tx.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, row.id),
          eq(messages.senderParticipantId, input.senderParticipantId),
          eq(messages.clientMsgId, idempotencyKey),
        ),
      );
    if (existing) {
      const value = await this.store.message(tx, row, existing, view);
      // 幂等重试只确认原消息，不能借旧键取回本人已隐藏/清空的正文。
      if (existing.seq <= view.state.clearedThroughSeq || view.hidden.has(existing.id)) {
        value.content = null;
        value.quote = null;
      }
      return { ok: true, value };
    }
    if (content.type === 'nudge') {
      const [target] = await tx.db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.id, content.targetParticipantId),
            eq(participants.conversationId, row.id),
          ),
        );
      if (!target)
        return { ok: false, error: 'invalid_content', message: '拍一拍目标不在此会话中' };
    }
    // L5（T-069）：用户发的图片、语音、表情、链接封面必须是本人可用的媒体（MediaSystemPort.canUse）。
    if (sender?.kind === 'user') {
      const invalid = await this.invalidUserMedia(sender.refId, content);
      if (invalid) return { ok: false, error: 'invalid_content', message: invalid };
    }
    if (input.quoteMessageId) {
      parseContract(Id, input.quoteMessageId);
      const [source] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, input.quoteMessageId), eq(messages.conversationId, row.id)));
      if (
        !source ||
        source.status === 'recalled' ||
        source.seq <= view.state.clearedThroughSeq ||
        view.hidden.has(source.id)
      )
        return { ok: false, error: 'invalid_content', message: '不能引用此消息' };
    }
    if (row.contentScope === 'adult') {
      const members = await tx.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.conversationId, row.id),
            eq(participants.kind, 'character'),
            isNull(participants.leftAt),
          ),
        );
      if (!members.length)
        return { ok: false, error: 'invalid_content', message: '该会话不能发送成人范围消息' };
      for (const member of members) {
        const decision = await this.policy.checkAdultGeneration(
          { userId: row.ownerUserId, characterId: member.refId, conversationId: row.id },
          tx,
        );
        if (!decision.allowed)
          return { ok: false, error: 'invalid_content', message: '角色资格已变化，请回到日常模式' };
      }
    }
    // 群聊 @：只保留仍在群里的参与者（SOC-04 第 1 条）；私聊忽略。
    let mentionedParticipantIds: string[] = [];
    if (row.type === 'group' && content.type === 'text' && content.mentions?.length) {
      const active = await tx.db
        .select({ id: participants.id })
        .from(participants)
        .where(and(eq(participants.conversationId, row.id), isNull(participants.leftAt)));
      const ids = new Set(active.map((p) => p.id));
      mentionedParticipantIds = [...new Set(content.mentions)].filter((m) => ids.has(m));
    }
    // 3.1（积压 ⑲）：图片消息从媒体记录填入字节数（客户端据此判断「添加到表情」是否可用）。
    if (content.type === 'image' && content.sizeBytes == null) {
      const sizeBytes = await this.imageSize(row.ownerUserId, content.mediaId);
      if (sizeBytes !== null) content = { ...content, sizeBytes };
    }
    const id = newId();
    const at = this.clock.now();
    const [current] = await tx.db
      .update(conversations)
      .set({ lastSeq: sql`${conversations.lastSeq} + 1`, updatedAt: at })
      .where(eq(conversations.id, row.id))
      .returning();
    if (!current) throw new AppError('not_found', '会话不存在');
    const encrypted = await this.crypto.seal(
      row.ownerUserId,
      `chat:message:${id}`,
      JSON.stringify(content),
      tx,
    );
    const [stored] = await tx.db
      .insert(messages)
      .values({
        id,
        conversationId: row.id,
        seq: current.lastSeq,
        senderParticipantId: input.senderParticipantId,
        senderKind: system ? 'system' : sender!.kind,
        clientMsgId: idempotencyKey,
        contentCiphertext: encrypted,
        quoteMessageId: input.quoteMessageId ?? null,
        status: 'normal',
        scope: current.contentScope,
        labels: labels.length ? labels : null,
        contentType: content.type,
        createdAt: at,
        recalledAt: null,
      })
      .returning();
    if (!stored) throw new AppError('internal_error', '消息未能保存');
    await tx.db
      .update(userConversationStates)
      .set({ hidden: row.trialExpiresAt !== null })
      .where(eq(userConversationStates.conversationId, row.id));
    const value = await this.store.message(tx, current, stored, view);
    await this.sync.appendUpdate(tx, row.ownerUserId, {
      type: 'message.created',
      data: { message: value },
    });
    await this.sync.appendUpdate(tx, row.ownerUserId, {
      type: 'conversation.updated',
      data: { conversation: await this.store.conversation(tx, current) },
    });
    await this.outbox.publish(tx, 'chat.message_created', 'chat', {
      conversationId: row.id,
      conversationType: row.type as 'direct' | 'group',
      messageId: id,
      seq: current.lastSeq,
      senderParticipantId: input.senderParticipantId,
      senderKind: system ? 'system' : (sender!.kind as 'user' | 'character'),
      senderRefId: sender?.refId ?? null,
      contentType: content.type,
      scope: current.contentScope as 'normal' | 'adult',
      quoteMessageId: input.quoteMessageId ?? null,
      mentionedParticipantIds,
      userRecipientIds: [row.ownerUserId],
    });
    return { ok: true, value };
  }
  private async imageSize(ownerUserId: string, mediaId: string): Promise<number | null> {
    try {
      return (await this.mediaRead.getMedia(ownerUserId, mediaId)).sizeBytes;
    } catch {
      return null;
    }
  }

  private async invalidUserMedia(userId: string, content: MessageContent): Promise<string | null> {
    switch (content.type) {
      case 'image':
        return (await this.media.canUse(userId, content.mediaId, ['chat_image']))
          ? null
          : '图片不存在或不能发送';
      case 'voice':
        return (await this.media.canUse(userId, content.mediaId, ['chat_voice']))
          ? null
          : '语音不存在或不能发送';
      case 'sticker':
        return (await this.stickers.canSendSticker(userId, {
          stickerId: content.stickerId,
          source: content.source,
          mediaId: content.mediaId,
        }))
          ? null
          : '表情不存在或不能发送';
      case 'link':
        if (!content.coverMediaId) return null;
        return (await this.media.canUse(userId, content.coverMediaId, ['chat_image']))
          ? null
          : '链接封面不存在';
      default:
        return null;
    }
  }
}
