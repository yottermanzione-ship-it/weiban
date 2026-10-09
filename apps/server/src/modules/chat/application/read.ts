import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import {
  ContentScope,
  Id,
  ListMessagesQuery,
  MessagePage,
  type ChatReadPort,
  type Conversation,
  type Message,
  type Participant,
  type ReadMessagesInput,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  DATABASE,
  parseContract,
  asDbTx,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import {
  conversations,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
import { ChatStore, type ConversationRow } from './store.js';

@Injectable()
export class ChatReadService implements ChatReadPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChatStore) private readonly store: ChatStore,
  ) {}
  async getNotificationContext(userId: string, messageId: string, input?: Tx) {
    parseContract(Id, userId);
    parseContract(Id, messageId);
    const read = async (tx: DbTx) => {
      const [first] = await tx.db.select().from(messages).where(eq(messages.id, messageId));
      if (!first) return null;
      let row: ConversationRow;
      try {
        row = await this.store.load(tx, first.conversationId, userId);
      } catch (error) {
        if (
          error instanceof AppError &&
          ['not_found', 'not_conversation_member', 'unauthenticated'].includes(error.code)
        )
          return null;
        throw error;
      }
      if (row.archivedAt) return null;
      const [message] = await tx.db.select().from(messages).where(eq(messages.id, messageId));
      const view = await this.store.view(tx, row, userId, ['normal']);
      if (
        !message ||
        message.status !== 'normal' ||
        view.state.hidden ||
        message.seq <= Math.max(view.state.readSeq, view.state.clearedThroughSeq) ||
        view.hidden.has(message.id)
      )
        return null;
      const [sender] = await tx.db
        .select()
        .from(participants)
        .where(eq(participants.id, message.senderParticipantId));
      if (!sender || (sender.kind === 'user' && sender.refId === userId)) return null;
      const [recipient] = await tx.db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.conversationId, row.id),
            eq(participants.kind, 'user'),
            eq(participants.refId, userId),
          ),
        );
      if (!recipient) return null;
      return {
        conversationId: row.id,
        conversationType: row.type as 'direct' | 'group',
        seq: message.seq,
        scope: message.scope as 'normal' | 'adult',
        senderKind: message.senderKind as 'user' | 'character' | 'system',
        senderRefId: sender.refId,
        recipientParticipantId: recipient.id,
        muted: view.state.muted,
        // 带 health 标签的消息不向推送提供正文（health-data.md 第 5 节、CHAT-10 第 7 条）。
        content:
          message.scope === 'normal' && !message.labels?.includes('health')
            ? await this.store.content(tx, row, message)
            : null,
      };
    };
    return input ? read(asDbTx(input)) : this.db.transaction(read);
  }
  private async internalConversation(tx: DbTx, row: ConversationRow): Promise<Conversation> {
    const result = await this.store.conversation(tx, row);
    if (result.lastMessage) {
      const [source] = await tx.db
        .select({ scope: messages.scope })
        .from(messages)
        .where(eq(messages.id, result.lastMessage.messageId));
      if (source?.scope === 'adult') result.lastMessage = { ...result.lastMessage, text: '[消息]' };
    }
    return result;
  }
  async getConversation(conversationId: string, input?: Tx): Promise<Conversation | null> {
    const read = async (tx: DbTx) => {
      try {
        return await this.internalConversation(tx, await this.store.load(tx, conversationId));
      } catch (error) {
        if (error instanceof AppError && error.code === 'not_found') return null;
        throw error;
      }
    };
    return input ? read(asDbTx(input)) : this.db.transaction(read);
  }
  async getParticipants(conversationId: string): Promise<Participant[]> {
    return (await this.getConversation(conversationId))?.participants ?? [];
  }
  async findDirectConversation(userId: string, characterId: string): Promise<Conversation | null> {
    parseContract(Id, userId);
    parseContract(Id, characterId);
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const [row] = await tx.db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.ownerUserId, userId),
            eq(conversations.characterId, characterId),
            eq(conversations.type, 'direct'),
          ),
        )
        .for('share');
      return row ? this.internalConversation(tx, row) : null;
    });
  }
  async readMessages(input: ReadMessagesInput): Promise<Message[]> {
    const query = parseContract(ListMessagesQuery, input);
    const scopes = parseContract(ContentScope.array(), input.scopes);
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, input.conversationId);
      if (!scopes.length) return [];
      const view = await this.store.view(tx, row, null, scopes);
      const rows = await tx.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.id),
            inArray(messages.scope, scopes),
            query.afterSeq === undefined ? undefined : gt(messages.seq, query.afterSeq),
            query.beforeSeq === undefined ? undefined : lt(messages.seq, query.beforeSeq),
          ),
        )
        .orderBy(query.afterSeq === undefined ? desc(messages.seq) : asc(messages.seq))
        .limit(query.limit);
      rows.sort((a, b) => a.seq - b.seq);
      const result: Message[] = [];
      for (const message of rows) result.push(await this.store.message(tx, row, message, view));
      return result;
    });
  }
  async getMessage(messageId: string, scopesInput: ContentScope[]): Promise<Message | null> {
    parseContract(Id, messageId);
    const scopes = parseContract(ContentScope.array(), scopesInput);
    return this.db.transaction(async (tx) => {
      const [stored] = await tx.db.select().from(messages).where(eq(messages.id, messageId));
      if (!stored || !scopes.includes(stored.scope as ContentScope)) return null;
      const row = await this.store.load(tx, stored.conversationId);
      // 锁定会话后重新读，避免等待期间消息被撤回而把旧正文返回。
      const [current] = await tx.db.select().from(messages).where(eq(messages.id, messageId));
      if (!current) return null;
      return this.store.message(tx, row, current, await this.store.view(tx, row, null, scopes));
    });
  }
  async listForUser(userId: string): Promise<{ items: Conversation[] }> {
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const rows = await tx.db
        .select()
        .from(conversations)
        .where(eq(conversations.ownerUserId, userId))
        .orderBy(conversations.id)
        .for('share');
      const items: Conversation[] = [];
      for (const row of rows) {
        if (row.archivedAt) continue;
        const value = await this.store.conversation(tx, row);
        if (!value.state.hidden) items.push(value);
      }
      items.sort(
        (a, b) =>
          Number(b.state.pinned) - Number(a.state.pinned) ||
          (b.lastMessage?.createdAt ?? b.updatedAt).localeCompare(
            a.lastMessage?.createdAt ?? a.updatedAt,
          ) ||
          a.conversationId.localeCompare(b.conversationId),
      );
      return { items };
    });
  }
  async forUser(userId: string, conversationId: string): Promise<Conversation> {
    return this.db.transaction(async (tx) =>
      this.store.conversation(tx, await this.store.load(tx, conversationId, userId)),
    );
  }
  async pageForUser(userId: string, conversationId: string, input: unknown): Promise<MessagePage> {
    const query = parseContract(ListMessagesQuery, input);
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const view = await this.store.view(tx, row, userId);
      const after = query.afterSeq;
      const before = query.beforeSeq;
      if (
        (after !== undefined && !Number.isSafeInteger(after)) ||
        (before !== undefined && !Number.isSafeInteger(before))
      )
        throw new AppError('bad_request', '消息游标不正确');
      const forward = after !== undefined;
      const from = forward
        ? after + 1
        : Math.max(1, Math.min(row.lastSeq, (before ?? row.lastSeq + 1) - 1) - query.limit + 1);
      const through = forward
        ? Math.min(row.lastSeq, after + query.limit)
        : Math.min(row.lastSeq, (before ?? row.lastSeq + 1) - 1);
      if (from > through)
        return MessagePage.parse({
          items: [],
          hasMore: false,
          coverage: { fromSeq: 0, throughSeq: 0, excludedRanges: [] },
        });
      const rows = await tx.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.id),
            gt(messages.seq, from - 1),
            lt(messages.seq, through + 1),
          ),
        )
        .orderBy(asc(messages.seq));
      if (rows.length !== through - from + 1)
        throw new AppError('internal_error', '消息记录不完整');
      const excludedRanges: NonNullable<MessagePage['coverage']>['excludedRanges'] = [];
      const items: Message[] = [];
      for (const message of rows) {
        const reason =
          message.seq <= view.state.clearedThroughSeq
            ? 'cleared'
            : view.hidden.has(message.id)
              ? 'hidden'
              : null;
        if (reason) {
          const previous = excludedRanges.at(-1);
          if (previous?.reason === reason && previous.throughSeq + 1 === message.seq)
            previous.throughSeq = message.seq;
          else excludedRanges.push({ fromSeq: message.seq, throughSeq: message.seq, reason });
        } else items.push(await this.store.message(tx, row, message, view));
      }
      return MessagePage.parse({
        items,
        hasMore: forward ? through < row.lastSeq : from > 1,
        coverage: { fromSeq: from, throughSeq: through, excludedRanges },
      });
    });
  }
  async stateForUser(tx: DbTx, userId: string, conversationId: string) {
    const [state] = await tx.db
      .select()
      .from(userConversationStates)
      .where(
        and(
          eq(userConversationStates.conversationId, conversationId),
          eq(userConversationStates.userId, userId),
        ),
      );
    if (!state) throw new AppError('not_conversation_member', '不能访问此会话');
    return state;
  }
}
