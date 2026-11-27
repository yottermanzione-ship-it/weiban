import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  EDIT_PULSE_MS,
  REPLY_QUIET_MS,
  MessageAck,
  SendMessageRequest,
  UpdateConversationStateRequest,
  UserConversationState,
  type ChatUserPort,
  type IdentityMembershipReadPort,
  type MediaSystemPort,
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
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { IDENTITY_MEMBERSHIP_READ_PORT } from '../../identity/index.js';
import {
  conversations,
  hiddenMessages,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
import { ChatStore } from './store.js';
import { ChatWriteService } from './write.js';
import { assertGroupChatEligible } from './group-access.js';

@Injectable()
export class ChatUserService implements ChatUserPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(IDENTITY_MEMBERSHIP_READ_PORT)
    private readonly membership: IdentityMembershipReadPort,
  ) {}
  async recordEdit(userId: string, conversationId: string, batchKey: string): Promise<void> {
    const until = new Date(this.clock.nowMs() + REPLY_QUIET_MS + EDIT_PULSE_MS);
    const changed = await this.db.query(
      `UPDATE chat.conversations SET reply_batch_key=$4,reply_quiet_until=greatest(reply_quiet_until,$3)
        WHERE id=$1 AND owner_user_id=$2 AND archived_at IS NULL RETURNING id`,
      [conversationId, userId, until, batchKey],
    );
    if (!changed.rowCount) throw new AppError('not_found', '会话不存在');
  }
  async sendMessage(
    userId: string,
    conversationId: string,
    input: SendMessageRequest,
  ): Promise<MessageAck> {
    const body = parseContract(SendMessageRequest, input);
    const batch = await this.persistMessages(userId, conversationId, [body]);
    return batch.items[0]!;
  }
  async persistMessages(
    userId: string,
    conversationId: string,
    items: SendMessageRequest[],
    quietBatch = false,
    more = false,
    nextKey?: string,
  ) {
    return this.db
      .transaction(async (tx) => {
        const row = await this.store.load(tx, conversationId, userId);
        // 10-25：群聊发言是 PRO+ 权益（403 membership_required）。历史消息仍可读，用户仍能打开这个群。
        if (row.type === 'group')
          await assertGroupChatEligible(this.membership, userId, 'send_group_message', tx);
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
        const confirmed = [];
        const initialSeq = row.lastSeq;
        // Only a batch whose first ID was witnessed before submission may reuse the already elapsed window.
        const trusted = quietBatch && row.replyBatchKey === items[0]?.clientMsgId;
        const quietUntil = row.replyQuietUntil;
        for (const body of items) {
          const result = await this.writer.post(tx, row, {
            conversationId: row.id,
            senderParticipantId: sender.id,
            content: body.content,
            idempotencyKey: body.clientMsgId,
            ...(body.quoteMessageId ? { quoteMessageId: body.quoteMessageId } : {}),
          });
          if (!result.ok)
            throw new AppError(
              result.error === 'not_conversation_member'
                ? 'not_conversation_member'
                : result.error === 'conversation_not_found'
                  ? 'not_found'
                  : 'bad_request',
              result.message ?? '消息未能保存',
            );
          confirmed.push(
            MessageAck.parse({ clientMsgId: body.clientMsgId, message: result.value }),
          );
        }
        const added = confirmed.filter((ack) => ack.message.seq > initialSeq);
        // A later piece may arrive after a restart or outage. Its immutable first ID
        // releases the earlier piece only in the transaction that actually saves its messages.
        const continuation = await tx.query<{ first_seq: string }>(
          'DELETE FROM chat.reply_batch_parts WHERE conversation_id=$1 AND next_key=ANY($2::text[]) RETURNING first_seq',
          [conversationId, confirmed.map((a) => a.clientMsgId)],
        );
        if (quietBatch && added.length) {
          const firstSeq = Math.min(
            added[0]!.message.seq,
            ...(continuation?.rows ?? []).map((r) => Number(r.first_seq)),
          );
          const lastSeq = added.at(-1)!.message.seq;
          await tx.query(
            'UPDATE chat.messages SET reply_batch_first_seq=$1 WHERE conversation_id=$2 AND seq>$3 AND seq<=$4',
            [firstSeq, conversationId, initialSeq, lastSeq],
          );
          if (more && nextKey)
            await tx.query(
              'INSERT INTO chat.reply_batch_parts(conversation_id,next_key,first_seq,last_seq) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM chat.messages WHERE conversation_id=$1 AND sender_participant_id=$5 AND client_msg_id=$2) ON CONFLICT DO NOTHING',
              [conversationId, nextKey, firstSeq, lastSeq, sender.id],
            );
        }
        if ((trusted || continuation?.rows.length) && quietUntil && added.length)
          await tx.db
            .update(conversations)
            .set({
              replyBatchKey: null,
              replyQuietUntil:
                more && !nextKey ? new Date(this.clock.nowMs() + REPLY_QUIET_MS) : quietUntil,
            })
            .where(eq(conversations.id, row.id));
        return { items: confirmed };
      })
      .catch(async (error: unknown) => {
        // A permanently invalid next piece is retried bubble by bubble by the client. Its earlier accepted bubbles must remain deliverable.
        if (error instanceof AppError && error.code === 'bad_request') {
          await this.db.query(
            'DELETE FROM chat.reply_batch_parts WHERE conversation_id=$1 AND next_key=ANY($2::text[]) AND EXISTS(SELECT 1 FROM chat.conversations WHERE id=$1 AND owner_user_id=$3)',
            [conversationId, items.map((item) => item.clientMsgId), userId],
          );
        }
        throw error;
      });
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
      // 3.41：只能挂本人上传、用途为 chat_background 的图；null 表示恢复默认。
      if (
        patch.backgroundMediaId !== undefined &&
        patch.backgroundMediaId !== null &&
        patch.backgroundMediaId !== (view.state.backgroundMediaId ?? null) &&
        !(await this.media.canUse(userId, patch.backgroundMediaId, ['chat_background']))
      )
        throw new AppError('bad_request', '请上传本人的聊天背景图片');
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
