import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  MessageAck,
  SendMessageRequest,
  UpdateConversationStateRequest,
  UserConversationState,
  type ChatUserPort,
  type Message,
  type SyncPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  P23_RECALL_WINDOW_MS,
  parseContract,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  conversations,
  hiddenMessages,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
import { ChatStore } from './store.js';
import { ChatWriteService } from './write.js';

@Injectable()
export class ChatUserService implements ChatUserPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}
  async sendMessage(
    userId: string,
    conversationId: string,
    input: SendMessageRequest,
  ): Promise<MessageAck> {
    const body = parseContract(SendMessageRequest, input);
    const result = await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const [sender] = await tx.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.conversationId, row.id),
            eq(participants.kind, 'user'),
            eq(participants.refId, userId),
          ),
        );
      if (!sender) throw new AppError('not_conversation_member', '不能在此会话发送消息');
      return this.writer.post(tx, row, {
        conversationId: row.id,
        senderParticipantId: sender.id,
        content: body.content,
        idempotencyKey: body.clientMsgId,
        ...(body.quoteMessageId ? { quoteMessageId: body.quoteMessageId } : {}),
      });
    });
    if (!result.ok)
      throw new AppError(
        result.error === 'not_conversation_member'
          ? 'not_conversation_member'
          : result.error === 'conversation_not_found'
            ? 'not_found'
            : 'bad_request',
        result.message ?? '消息未能发送',
      );
    return MessageAck.parse({ clientMsgId: body.clientMsgId, message: result.value });
  }
  async recall(userId: string, conversationId: string, messageId: string): Promise<Message> {
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const [message] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.conversationId, row.id)));
      if (!message) throw new AppError('not_found', '消息不存在');
      const [sender] = await tx.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.id, message.senderParticipantId),
            eq(participants.kind, 'user'),
            eq(participants.refId, userId),
          ),
        );
      if (!sender) throw new AppError('forbidden', '只能撤回自己的消息');
      if (message.status === 'recalled')
        return this.store.message(tx, row, message, await this.store.view(tx, row, userId));
      if (this.clock.nowMs() - message.createdAt.getTime() >= P23_RECALL_WINDOW_MS)
        throw new AppError('recall_window_expired', '已超过可撤回时间');
      const at = this.clock.now();
      const [updated] = await tx.db
        .update(messages)
        .set({ status: 'recalled', contentCiphertext: null, recalledAt: at })
        .where(eq(messages.id, message.id))
        .returning();
      await tx.db.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, row.id));
      await this.sync.appendUpdate(tx, userId, {
        type: 'message.recalled',
        data: { conversationId: row.id, messageId: message.id, recalledAt: at.toISOString() },
      });
      const current = await this.store.load(tx, row.id, userId);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.updated',
        data: { conversation: await this.store.conversation(tx, current) },
      });
      await this.outbox.publish(tx, 'chat.message_recalled', 'chat', {
        conversationId: row.id,
        messageId: message.id,
        seq: message.seq,
        recalledByParticipantId: sender.id,
      });
      return this.store.message(tx, current, updated!, await this.store.view(tx, current, userId));
    });
  }
  async hide(userId: string, conversationId: string, messageId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const [message] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.conversationId, row.id)));
      if (!message) throw new AppError('not_found', '消息不存在');
      const added = await tx.db
        .insert(hiddenMessages)
        .values({ messageId: message.id, userId })
        .onConflictDoNothing()
        .returning();
      if (!added.length) return;
      await this.sync.appendUpdate(tx, userId, {
        type: 'message.hidden',
        data: { conversationId: row.id, messageId: message.id },
      });
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.updated',
        data: { conversation: await this.store.conversation(tx, row) },
      });
    });
  }
  async updateState(
    userId: string,
    conversationId: string,
    input: unknown,
  ): Promise<UserConversationState> {
    const patch = parseContract(UpdateConversationStateRequest, input);
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const view = await this.store.view(tx, row, userId);
      if (
        !Object.entries(patch).some(
          ([key, value]) => view.state[key as keyof UserConversationState] !== value,
        )
      )
        return view.state;
      const [state] = await tx.db
        .update(userConversationStates)
        .set(patch)
        .where(
          and(
            eq(userConversationStates.conversationId, row.id),
            eq(userConversationStates.userId, userId),
          ),
        )
        .returning();
      const conversation = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.state_updated',
        data: {
          conversationId: row.id,
          state: UserConversationState.parse(state),
          unreadCount: conversation.unreadCount,
        },
      });
      return UserConversationState.parse(state);
    });
  }
  async clear(userId: string, conversationId: string): Promise<UserConversationState> {
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const view = await this.store.view(tx, row, userId);
      if (view.state.clearedThroughSeq === row.lastSeq && !view.state.markedUnread)
        return view.state;
      const [state] = await tx.db
        .update(userConversationStates)
        .set({ clearedThroughSeq: row.lastSeq, markedUnread: false })
        .where(
          and(
            eq(userConversationStates.conversationId, row.id),
            eq(userConversationStates.userId, userId),
          ),
        )
        .returning();
      const conversation = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.state_updated',
        data: {
          conversationId: row.id,
          state: UserConversationState.parse(state),
          unreadCount: conversation.unreadCount,
        },
      });
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.updated',
        data: { conversation },
      });
      return UserConversationState.parse(state);
    });
  }
  async markRead(userId: string, conversationId: string, readSeq: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const view = await this.store.view(tx, row, userId);
      if (!Number.isSafeInteger(readSeq) || readSeq < 1 || readSeq > row.lastSeq)
        throw new AppError('bad_request', '已读位置不正确');
      if (readSeq <= view.state.readSeq && !view.state.markedUnread) return;
      const next = Math.max(readSeq, view.state.readSeq);
      await tx.db
        .update(userConversationStates)
        .set({ readSeq: next, markedUnread: false })
        .where(
          and(
            eq(userConversationStates.conversationId, row.id),
            eq(userConversationStates.userId, userId),
          ),
        );
      const [owner] = await tx.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.conversationId, row.id),
            eq(participants.kind, 'user'),
            eq(participants.refId, userId),
          ),
        );
      if (!owner) throw new AppError('internal_error', '会话状态不完整');
      await tx.db
        .update(participants)
        .set({ readSeq: Math.max(owner.readSeq, next) })
        .where(eq(participants.id, owner.id));
      const conversation = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.state_updated',
        data: {
          conversationId: row.id,
          state: conversation.state,
          unreadCount: conversation.unreadCount,
        },
      });
      if (next > view.state.readSeq)
        await this.outbox.publish(tx, 'chat.read_cursor_moved', 'chat', {
          conversationId: row.id,
          participantId: owner.id,
          participantKind: 'user',
          readSeq: next,
        });
    });
  }
  async markUnread(userId: string, conversationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const view = await this.store.view(tx, row, userId);
      if (view.state.markedUnread) return;
      await tx.db
        .update(userConversationStates)
        .set({ markedUnread: true })
        .where(
          and(
            eq(userConversationStates.conversationId, row.id),
            eq(userConversationStates.userId, userId),
          ),
        );
      const conversation = await this.store.conversation(tx, row);
      await this.sync.appendUpdate(tx, userId, {
        type: 'conversation.state_updated',
        data: {
          conversationId: row.id,
          state: conversation.state,
          unreadCount: conversation.unreadCount,
        },
      });
    });
  }
}
