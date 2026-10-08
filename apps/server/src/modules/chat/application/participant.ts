import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  Id,
  type ChatParticipantPort,
  type Message,
  type PostMessageInput,
  type PostMessageError,
  type PortResult,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  asDbTx,
  type DbTx,
  CLOCK,
  DATABASE,
  OUTBOX,
  parseContract,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { conversations, messages, participants } from '../infra/db/schema.js';
import { ChatStore, type ConversationRow } from './store.js';
import { ChatWriteService } from './write.js';

@Injectable()
export class ChatParticipantService implements ChatParticipantPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}
  async postMessage(
    input: PostMessageInput,
    transaction?: Tx,
  ): Promise<PortResult<Message, PostMessageError>> {
    try {
      const post = async (tx: DbTx) => {
        const row = await this.store.load(tx, input.conversationId);
        if (input.expectedScope !== undefined && row.contentScope !== input.expectedScope)
          return {
            ok: false as const,
            error: 'invalid_content' as const,
            message: '内容范围已变化',
          };
        return this.writer.post(tx, row, input);
      };
      return transaction ? await post(asDbTx(transaction)) : await this.db.transaction(post);
    } catch (error) {
      if (error instanceof AppError && error.code === 'not_found')
        return { ok: false, error: 'conversation_not_found', message: '会话不存在' };
      if (error instanceof AppError && error.code === 'unauthenticated')
        return { ok: false, error: 'not_conversation_member', message: '会话已停用' };
      if (error instanceof AppError && error.code === 'bad_request')
        return { ok: false, error: 'invalid_content', message: '消息格式不正确' };
      throw error;
    }
  }
  async markRead(input: Parameters<ChatParticipantPort['markRead']>[0]): Promise<void> {
    parseContract(Id, input.participantId);
    await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, input.conversationId);
      if (!Number.isSafeInteger(input.readSeq) || input.readSeq < 0 || input.readSeq > row.lastSeq)
        throw new AppError('bad_request', '已读位置不正确');
      const [participant] = await tx.db
        .select()
        .from(participants)
        .where(
          and(eq(participants.conversationId, row.id), eq(participants.id, input.participantId)),
        );
      if (!participant) throw new AppError('not_conversation_member', '参与者不在此会话中');
      if (input.readSeq <= participant.readSeq) return;
      if (participant.kind === 'user')
        throw new AppError('bad_request', '用户已读状态请通过用户接口更新');
      await tx.db
        .update(participants)
        .set({ readSeq: input.readSeq })
        .where(eq(participants.id, participant.id));
      if (row.type === 'direct')
        await this.sync.appendUpdate(tx, row.ownerUserId, {
          type: 'conversation.peer_read_updated',
          data: { conversationId: row.id, peerReadSeq: input.readSeq },
        });
      await this.sync.appendUpdate(tx, row.ownerUserId, {
        type: 'conversation.updated',
        data: { conversation: await this.store.conversation(tx, row) },
      });
      await this.outbox.publish(tx, 'chat.read_cursor_moved', 'chat', {
        conversationId: row.id,
        participantId: participant.id,
        participantKind: participant.kind as 'character',
        readSeq: input.readSeq,
      });
    });
  }
  async setTyping(input: Parameters<ChatParticipantPort['setTyping']>[0]): Promise<void> {
    parseContract(Id, input.participantId);
    if (!['start', 'stop'].includes(input.state))
      throw new AppError('bad_request', '正在输入状态不正确');
    const userId = await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, input.conversationId);
      if (row.archivedAt) return null;
      const [participant] = await tx.db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(eq(participants.conversationId, row.id), eq(participants.id, input.participantId)),
        );
      if (!participant) throw new AppError('not_conversation_member', '参与者不在此会话中');
      return row.ownerUserId;
    });
    if (userId)
      await this.sync.sendEphemeral(userId, {
        type: 'typing',
        conversationId: input.conversationId,
        participantId: input.participantId,
        state: input.state,
      });
  }
  async recall(
    input: Parameters<ChatParticipantPort['recall']>[0],
  ): Promise<PortResult<Message, 'not_found' | 'not_sender'>> {
    return this.db.transaction(async (tx) => {
      let row: ConversationRow;
      try {
        row = await this.store.load(tx, input.conversationId);
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found')
          return { ok: false, error: 'not_found', message: '会话不存在' };
        throw error;
      }
      const [message] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, input.messageId), eq(messages.conversationId, row.id)));
      if (!message) return { ok: false, error: 'not_found', message: '消息不存在' };
      if (message.senderParticipantId !== input.participantId || message.senderKind !== 'character')
        return { ok: false, error: 'not_sender', message: '只能以角色身份撤回自己的消息' };
      if (message.status === 'recalled')
        return {
          ok: true,
          value: await this.store.message(
            tx,
            row,
            message,
            await this.store.view(tx, row, row.ownerUserId),
          ),
        };
      const at = this.clock.now();
      const [updated] = await tx.db
        .update(messages)
        .set({ status: 'recalled', contentCiphertext: null, recalledAt: at })
        .where(eq(messages.id, message.id))
        .returning();
      await tx.db.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, row.id));
      await this.sync.appendUpdate(tx, row.ownerUserId, {
        type: 'message.recalled',
        data: { conversationId: row.id, messageId: message.id, recalledAt: at.toISOString() },
      });
      const current = await this.store.load(tx, row.id);
      await this.sync.appendUpdate(tx, row.ownerUserId, {
        type: 'conversation.updated',
        data: { conversation: await this.store.conversation(tx, current) },
      });
      await this.outbox.publish(tx, 'chat.message_recalled', 'chat', {
        conversationId: row.id,
        messageId: message.id,
        seq: message.seq,
        recalledByParticipantId: input.participantId,
      });
      return {
        ok: true,
        value: await this.store.message(
          tx,
          current,
          updated!,
          await this.store.view(tx, current, row.ownerUserId),
        ),
      };
    });
  }
}
