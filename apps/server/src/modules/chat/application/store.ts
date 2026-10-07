import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, notInArray, sql } from 'drizzle-orm';
import {
  Conversation,
  Id,
  Message,
  MessageContent,
  UserConversationState,
  type ContentScope,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  AppError,
  ENVELOPE_CRYPTO,
  parseContract,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import {
  conversations,
  hiddenMessages,
  messages,
  participants,
  userConversationStates,
} from '../infra/db/schema.js';
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export interface MessageView {
  userId: string | null;
  state: UserConversationState;
  hidden: Set<string>;
  scopes: ContentScope[];
}

export const emptyState: UserConversationState = {
  pinned: false,
  muted: false,
  hidden: false,
  clearedThroughSeq: 0,
  readSeq: 0,
  markedUnread: false,
};
export const previewText = (text: string): string =>
  text.slice(0, 100).replace(/[\uD800-\uDBFF]$/u, '');

@Injectable()
export class ChatStore {
  constructor(
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
  ) {}

  async requireActive(tx: DbTx, userId: string): Promise<void> {
    parseContract(Id, userId);
    if ((await this.accounts.getAccountStatus(userId, tx)) !== 'active')
      throw new AppError('unauthenticated', '账号已失效');
  }
  async load(tx: DbTx, conversationId: string, userId?: string): Promise<ConversationRow> {
    parseContract(Id, conversationId);
    const [row] = await tx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .for('update');
    if (!row) throw new AppError('not_found', '会话不存在');
    if (userId && row.ownerUserId !== userId)
      throw new AppError('not_conversation_member', '不能访问此会话');
    await this.requireActive(tx, row.ownerUserId);
    return row;
  }
  async view(
    tx: DbTx,
    row: ConversationRow,
    userId: string | null,
    scopes: ContentScope[] = ['normal', 'adult'],
  ): Promise<MessageView> {
    let state: UserConversationState = { ...emptyState };
    const hidden = new Set<string>();
    if (userId) {
      const [stored] = await tx.db
        .select()
        .from(userConversationStates)
        .where(
          and(
            eq(userConversationStates.conversationId, row.id),
            eq(userConversationStates.userId, userId),
          ),
        );
      if (!stored) throw new AppError('not_conversation_member', '不能访问此会话');
      state = UserConversationState.parse(stored);
      const rows = await tx.db
        .select({ id: hiddenMessages.messageId })
        .from(hiddenMessages)
        .innerJoin(messages, eq(messages.id, hiddenMessages.messageId))
        .where(and(eq(hiddenMessages.userId, userId), eq(messages.conversationId, row.id)));
      for (const hiddenRow of rows) hidden.add(hiddenRow.id);
    }
    return { userId, state, hidden, scopes };
  }
  async content(
    tx: DbTx,
    row: ConversationRow,
    message: MessageRow,
  ): Promise<MessageContent | null> {
    if (message.status === 'recalled' || !message.contentCiphertext) return null;
    const plain = await this.crypto.open(
      row.ownerUserId,
      `chat:message:${message.id}`,
      message.contentCiphertext,
      tx,
    );
    try {
      return MessageContent.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
  async message(
    tx: DbTx,
    row: ConversationRow,
    stored: MessageRow,
    view: MessageView,
  ): Promise<Message> {
    let quote: Message['quote'] = null;
    if (stored.quoteMessageId && stored.status !== 'recalled') {
      const [source] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, stored.quoteMessageId), eq(messages.conversationId, row.id)));
      if (source) {
        let preview: string | null = null;
        if (
          source.status !== 'recalled' &&
          source.seq > view.state.clearedThroughSeq &&
          !view.hidden.has(source.id) &&
          (source.scope === 'normal' || stored.scope === 'adult') &&
          view.scopes.includes(source.scope as ContentScope)
        ) {
          const content = await this.content(tx, row, source);
          if (content?.type === 'text') preview = previewText(content.text);
          else if (content) preview = '[消息]';
        }
        quote = { messageId: source.id, seq: source.seq, preview };
      }
    }
    return Message.parse({
      messageId: stored.id,
      conversationId: row.id,
      seq: stored.seq,
      senderParticipantId: stored.senderParticipantId,
      senderKind: stored.senderKind,
      content: await this.content(tx, row, stored),
      quote,
      status: stored.status,
      scope: stored.scope,
      clientMsgId: view.userId && stored.senderKind === 'user' ? stored.clientMsgId : null,
      createdAt: stored.createdAt.toISOString(),
      recalledAt: stored.recalledAt?.toISOString() ?? null,
    });
  }
  async conversation(tx: DbTx, row: ConversationRow): Promise<Conversation> {
    const view = await this.view(tx, row, row.ownerUserId);
    const members = await tx.db
      .select()
      .from(participants)
      .where(eq(participants.conversationId, row.id))
      .orderBy(participants.joinedAt, participants.id);
    const owner = members.find((p) => p.kind === 'user' && p.refId === row.ownerUserId);
    if (!owner) throw new AppError('internal_error', '会话状态不完整');
    const visible = and(
      eq(messages.conversationId, row.id),
      gt(messages.seq, view.state.clearedThroughSeq),
      view.hidden.size ? notInArray(messages.id, [...view.hidden]) : undefined,
    );
    const [last] = await tx.db
      .select()
      .from(messages)
      .where(visible)
      .orderBy(desc(messages.seq))
      .limit(1);
    let lastMessage: Conversation['lastMessage'] = null;
    if (last) {
      const content = await this.content(tx, row, last);
      const text =
        last.status === 'recalled'
          ? last.senderKind === 'user'
            ? '你撤回了一条消息'
            : '对方撤回了一条消息'
          : content?.type === 'text'
            ? previewText(content.text)
            : content?.type === 'nudge'
              ? '[拍一拍]'
              : content?.type === 'system' && content.code === 'contact_accepted'
                ? '通过了你的好友申请'
                : '[消息]';
      lastMessage = {
        messageId: last.id,
        seq: last.seq,
        senderParticipantId: last.senderParticipantId,
        text,
        createdAt: last.createdAt.toISOString(),
      };
    }
    const [count] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          visible,
          gt(messages.seq, view.state.readSeq),
          sql`${messages.senderParticipantId} <> ${owner.id}`,
        ),
      );
    return Conversation.parse({
      conversationId: row.id,
      type: row.type,
      title: row.title,
      participants: members.map((p) => ({
        participantId: p.id,
        kind: p.kind,
        refId: p.refId,
        joinedAt: p.joinedAt.toISOString(),
      })),
      contentScope: row.contentScope,
      lastSeq: row.lastSeq,
      lastMessage,
      state: view.state,
      unreadCount: count?.n ?? 0,
      peerReadSeq:
        row.type === 'direct' ? (members.find((p) => p.kind === 'character')?.readSeq ?? 0) : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
