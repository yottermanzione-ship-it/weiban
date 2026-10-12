/**
 * 卡片消息按钮（ADR-0026，T-063）：用户只能点一次；同一 actionId 重复提交返回原结果（幂等），
 * 换一个按钮再点返回 409 action_already_chosen。chat 只记录选择并发事件，由 ref 所属模块处理业务。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { Id, type Message, type SyncPort } from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  parseContract,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { messages, participants } from '../infra/db/schema.js';
import { ChatStore } from './store.js';

const ACTION_ID = /^[a-z0-9_]{1,32}$/;

@Injectable()
export class ChatActionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(OUTBOX) private readonly outbox: Outbox,
  ) {}

  async choose(
    userId: string,
    conversationId: string,
    messageId: string,
    actionId: string,
  ): Promise<Message> {
    parseContract(Id, messageId);
    if (typeof actionId !== 'string' || !ACTION_ID.test(actionId))
      throw new AppError('bad_request', '按钮不正确');
    return this.db.transaction(async (tx) => {
      const row = await this.store.load(tx, conversationId, userId);
      const [stored] = await tx.db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.conversationId, row.id)))
        .for('update');
      if (!stored) throw new AppError('not_found', '消息不存在');
      const view = await this.store.view(tx, row, userId);
      if (stored.seq <= view.state.clearedThroughSeq || view.hidden.has(stored.id))
        throw new AppError('not_found', '消息不存在');
      if (stored.actionId) {
        if (stored.actionId === actionId) return this.store.message(tx, row, stored, view);
        throw new AppError('action_already_chosen', '已经选过了');
      }
      const content = await this.store.content(tx, row, stored);
      if (stored.status !== 'normal' || content?.type !== 'action_card')
        throw new AppError('bad_request', '这条消息没有可点的按钮');
      if (!content.actions.some((a) => a.actionId === actionId))
        throw new AppError('bad_request', '按钮不正确');
      const at = this.clock.now();
      const [updated] = await tx.db
        .update(messages)
        .set({ actionId, actionChosenAt: at })
        .where(and(eq(messages.id, stored.id), isNull(messages.actionId)))
        .returning();
      if (!updated) throw new AppError('action_already_chosen', '已经选过了');
      const message = await this.store.message(tx, row, updated, view);
      await this.sync.appendUpdate(tx, userId, { type: 'message.updated', data: { message } });
      const [sender] = await tx.db
        .select({ kind: participants.kind, refId: participants.refId })
        .from(participants)
        .where(eq(participants.id, stored.senderParticipantId));
      await this.outbox.publish(tx, 'chat.message_action_chosen', 'chat', {
        conversationId: row.id,
        messageId: stored.id,
        userId,
        characterId: sender?.kind === 'character' ? sender.refId : null,
        cardKind: String(content.cardKind),
        actionId,
        ref: content.ref,
      });
      return message;
    });
  }
}
