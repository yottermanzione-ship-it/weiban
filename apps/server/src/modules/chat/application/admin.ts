import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ContentScope,
  Id,
  SystemContent,
  type ChatAdminPort,
  type Conversation,
  type Message,
  type PolicyPort,
  type Tx,
  type SyncPort,
  type PortResult,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  asDbTx,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { conversations, participants, userConversationStates } from '../infra/db/schema.js';
import { ChatStore, type ConversationRow } from './store.js';
import { ChatWriteService } from './write.js';

@Injectable()
export class ChatAdminService implements ChatAdminPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
  ) {}
  async ensureDirectConversation(
    transaction: Tx,
    input: Parameters<ChatAdminPort['ensureDirectConversation']>[1],
  ): Promise<Conversation> {
    const tx = asDbTx(transaction);
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('chat:direct:' || $1 || ':' || $2,0))",
      [input.userId, input.characterId],
    );
    await this.store.requireActive(tx, input.userId);
    const [existing] = await tx.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerUserId, input.userId),
          eq(conversations.characterId, input.characterId),
          eq(conversations.type, 'direct'),
        ),
      )
      .for('update');
    if (existing && (!existing.archivedAt || input.restoreHistory)) {
      if (existing.archivedAt) {
        await tx.db
          .update(conversations)
          .set({ archivedAt: null, updatedAt: this.clock.now() })
          .where(eq(conversations.id, existing.id));
        await tx.db
          .update(userConversationStates)
          .set({ hidden: false })
          .where(eq(userConversationStates.conversationId, existing.id));
        const row = await this.store.load(tx, existing.id, input.userId);
        const conversation = await this.store.conversation(tx, row);
        await this.sync.appendUpdate(tx, input.userId, {
          type: 'conversation.updated',
          data: { conversation },
        });
        return conversation;
      }
      return this.store.conversation(tx, existing);
    }
    if (existing) await tx.db.delete(conversations).where(eq(conversations.id, existing.id));
    const at = this.clock.now();
    const id = newId();
    const [row] = await tx.db
      .insert(conversations)
      .values({
        id,
        ownerUserId: input.userId,
        type: 'direct',
        characterId: input.characterId,
        title: null,
        systemParticipantId: newId(),
        contentScope: 'normal',
        lastSeq: 0,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    if (!row) throw new AppError('internal_error', '会话未能创建');
    const userParticipantId = newId();
    const characterParticipantId = newId();
    await tx.db.insert(participants).values([
      {
        id: userParticipantId,
        conversationId: id,
        kind: 'user',
        refId: input.userId,
        joinedAt: at,
        readSeq: 0,
      },
      {
        id: characterParticipantId,
        conversationId: id,
        kind: 'character',
        refId: input.characterId,
        joinedAt: at,
        readSeq: 0,
      },
    ]);
    await tx.db.insert(userConversationStates).values({ conversationId: id, userId: input.userId });
    const conversation = await this.store.conversation(tx, row);
    await this.sync.appendUpdate(tx, input.userId, {
      type: 'conversation.created',
      data: { conversation },
    });
    await this.outbox.publish(tx, 'chat.conversation_created', 'chat', {
      conversationId: id,
      type: 'direct',
      participants: conversation.participants.map((p) => ({
        participantId: p.participantId,
        kind: p.kind,
        refId: p.refId,
      })),
    });
    return conversation;
  }
  async archiveDirectConversation(
    transaction: Tx,
    input: { userId: string; characterId: string },
  ): Promise<void> {
    await this.removeDirect(transaction, input, false);
  }
  async purgeDirectConversation(
    transaction: Tx,
    input: { userId: string; characterId: string },
  ): Promise<void> {
    await this.removeDirect(transaction, input, true);
  }
  private async removeDirect(
    transaction: Tx,
    input: { userId: string; characterId: string },
    purge: boolean,
  ): Promise<void> {
    const tx = asDbTx(transaction);
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('chat:direct:' || $1 || ':' || $2,0))",
      [input.userId, input.characterId],
    );
    await this.store.requireActive(tx, input.userId);
    const [row] = await tx.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerUserId, input.userId),
          eq(conversations.characterId, input.characterId),
          eq(conversations.type, 'direct'),
        ),
      )
      .for('update');
    if (!row || (!purge && row.archivedAt)) return;
    await tx.db
      .update(conversations)
      .set({ archivedAt: this.clock.now(), updatedAt: this.clock.now() })
      .where(eq(conversations.id, row.id));
    await tx.db
      .update(userConversationStates)
      .set({
        hidden: true,
        ...(purge ? { clearedThroughSeq: row.lastSeq, markedUnread: false } : {}),
      })
      .where(eq(userConversationStates.conversationId, row.id));
    const conversation = await this.store.conversation(tx, await this.store.load(tx, row.id));
    await this.sync.appendUpdate(tx, input.userId, {
      type: 'conversation.state_updated',
      data: {
        conversationId: row.id,
        state: conversation.state,
        unreadCount: conversation.unreadCount,
      },
    });
    await this.sync.appendUpdate(tx, input.userId, {
      type: 'conversation.updated',
      data: { conversation },
    });
    if (purge) await tx.db.delete(conversations).where(eq(conversations.id, row.id));
  }
  async postSystemMessage(
    transaction: Tx | null,
    input: Parameters<ChatAdminPort['postSystemMessage']>[1],
  ): Promise<Message> {
    const action = async (tx: DbTx) => {
      const row = await this.store.load(tx, input.conversationId);
      const content = parseContract(SystemContent, {
        type: 'system',
        code: input.code,
        params: input.params ?? {},
      });
      const result = await this.writer.post(
        tx,
        row,
        {
          conversationId: row.id,
          senderParticipantId: row.systemParticipantId,
          content,
          idempotencyKey: input.idempotencyKey,
        },
        'system',
      );
      if (!result.ok) throw new AppError('bad_request', result.message ?? '系统消息未能发送');
      return result.value;
    };
    return transaction ? action(asDbTx(transaction)) : this.db.transaction(action);
  }
  async setContentScope(
    input: Parameters<ChatAdminPort['setContentScope']>[0],
  ): Promise<PortResult<void, 'not_found' | 'adult_mode_not_eligible'>> {
    parseContract(Id, input.conversationId);
    const scope = parseContract(ContentScope, input.scope);
    const result = await this.db.transaction(async (tx) => {
      let row: ConversationRow;
      try {
        row = await this.store.load(tx, input.conversationId);
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') return 'missing' as const;
        throw error;
      }
      if (scope === 'adult') {
        const members = await tx.db
          .select()
          .from(participants)
          .where(and(eq(participants.conversationId, row.id), eq(participants.kind, 'character')));
        if (!members.length) return 'denied' as const;
        for (const member of members) {
          const decision = await this.policy.checkAdultGeneration(
            { userId: row.ownerUserId, characterId: member.refId, conversationId: row.id },
            tx,
          );
          if (!decision.allowed) return 'denied' as const;
        }
      }
      if (row.contentScope === scope) return 'updated' as const;
      const [updated] = await tx.db
        .update(conversations)
        .set({ contentScope: scope, updatedAt: this.clock.now() })
        .where(eq(conversations.id, row.id))
        .returning();
      await this.sync.appendUpdate(tx, row.ownerUserId, {
        type: 'conversation.updated',
        data: { conversation: await this.store.conversation(tx, updated!) },
      });
      await this.outbox.publish(tx, 'chat.content_scope_changed', 'chat', {
        conversationId: row.id,
        scope,
      });
      return 'updated' as const;
    });
    // 判定拒绝的事务正常提交，保留policy审计；之后才向调用方报告拒绝。
    if (result === 'denied')
      return { ok: false, error: 'adult_mode_not_eligible', message: '该会话不能开启成人模式' };
    return result === 'missing'
      ? { ok: false, error: 'not_found', message: '会话不存在' }
      : { ok: true, value: undefined };
  }
}
