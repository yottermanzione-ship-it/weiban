import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  ChatReplyTriggerReadPort,
  ContactsReadPort,
  ReplyDeliveryIssue,
} from '@weiban/contracts';
import { AppError } from '../../../platform/index.js';
import { CHAT_REPLY_TRIGGER_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { replyPlans } from '../infra/db/schema.js';
import { ReplyPlanStore, type ReplyPlan } from './plan-store.js';

const statusColumns = {
  triggerId: replyPlans.triggerId,
  retryEpoch: replyPlans.retryEpoch,
  status: replyPlans.status,
  failure: replyPlans.failure,
  kind: replyPlans.kind,
  nextBubble: replyPlans.nextBubble,
};
function issueOf(row: Pick<ReplyPlan, keyof typeof statusColumns>): ReplyDeliveryIssue | null {
  if (!row.failure || row.kind !== 'message' || row.nextBubble !== 0 || row.status === 'done')
    return null;
  const base = { messageId: row.triggerId, epoch: row.retryEpoch };
  if (['queued', 'generating', 'sending'].includes(row.status)) {
    return { ...base, state: 'retrying', reason: 'provider_unavailable', canRetry: false };
  }
  if (['manual_retry', 'superseded', 'source_unavailable'].includes(row.failure)) return null;
  let reason: ReplyDeliveryIssue['reason'];
  switch (row.failure) {
    case 'provider_unavailable':
    case 'model_unavailable':
    case 'insufficient_balance':
    case 'budget_exceeded':
    case 'request_too_large':
    case 'interrupted':
    case 'concurrency_limited':
      reason = row.failure;
      break;
    case 'wait_expired':
    case 'timeout_deadline':
    case 'upstream_cooldown':
    case 'route_unavailable_or_busy':
    case 'insufficient_fallback_time':
    case 'rate_limited':
      reason = 'provider_unavailable';
      break;
    case 'no_route':
    case 'no_matching_route_bounds':
    case 'quota_exhausted':
    case 'invalid_key':
      reason = 'model_unavailable';
      break;
    case 'account_limited':
    case 'account_concurrency_limited':
    case 'account_rate_limited':
      reason = 'concurrency_limited';
      break;
    default:
      reason = 'unavailable';
  }
  const blocked = [
    'insufficient_balance',
    'budget_exceeded',
    'request_too_large',
    'interrupted',
  ].includes(reason);
  return {
    ...base,
    reason,
    state: blocked
      ? 'blocked'
      : row.status === 'waiting' && reason !== 'unavailable'
        ? 'waiting'
        : 'failed',
    canRetry: !blocked && reason !== 'unavailable',
  };
}

@Injectable()
export class ReplyDeliveryStatusService {
  constructor(
    @Inject(ReplyPlanStore) private readonly store: ReplyPlanStore,
    @Inject(CHAT_REPLY_TRIGGER_READ_PORT) private readonly chat: ChatReplyTriggerReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}

  async list(userId: string, conversationId: string, ids: string[]) {
    return this.store.db.transaction(async (tx) => {
      const visible = await this.chat.visibleReplyTriggers(userId, conversationId, ids, tx);
      if (!visible.length) return { items: [] };
      const plans = await tx.db
        .select(statusColumns)
        .from(replyPlans)
        .where(
          and(
            eq(replyPlans.userId, userId),
            eq(replyPlans.conversationId, conversationId),
            eq(replyPlans.kind, 'message'),
            eq(replyPlans.nextBubble, 0),
            inArray(replyPlans.triggerId, visible),
          ),
        );
      return { items: plans.map(issueOf).filter((i): i is ReplyDeliveryIssue => i !== null) };
    });
  }

  async retry(userId: string, conversationId: string, messageId: string, epoch: number) {
    return this.store.db.transaction(async (tx) => {
      if (!(await this.store.lock(tx, userId, conversationId)))
        throw new AppError('forbidden', '账号不可用');
      if (!(await this.chat.visibleReplyTriggers(userId, conversationId, [messageId], tx)).length)
        throw new AppError('not_found', '这条消息已不可见');
      const [row] = await tx.db
        .select({
          ...statusColumns,
          id: replyPlans.id,
          characterId: replyPlans.characterId,
          createdAt: replyPlans.createdAt,
        })
        .from(replyPlans)
        .where(
          and(
            eq(replyPlans.userId, userId),
            eq(replyPlans.conversationId, conversationId),
            eq(replyPlans.triggerId, messageId),
            eq(replyPlans.kind, 'message'),
          ),
        )
        .for('update');
      if (!row) throw new AppError('not_found', '这条消息没有待恢复的回复');
      const issue = issueOf(row);
      if (!issue || row.retryEpoch !== epoch || !issue.canRetry) return { issue };
      const contact = await this.contacts.getActiveContactEpoch(userId, row.characterId, tx);
      if (!contact || row.createdAt < new Date(contact.acceptAfter))
        throw new AppError('conflict', '当前好友关系已变化');
      const now = this.store.clock.now();
      const [queued] = await tx.db
        .update(replyPlans)
        .set({
          status: 'queued',
          failure: 'manual_retry',
          manualRequested: true,
          retryEpoch: row.retryEpoch + 1,
          inputCiphertext: null,
          resultCiphertext: null,
          leaseId: null,
          leaseUntil: null,
          dueAt: now,
        })
        .where(eq(replyPlans.id, row.id))
        .returning();
      await this.store.schedule(tx, row.id, now);
      await this.store.receipt(tx, queued!, 'deferred', 'manual_retry_queued', null, now);
      return { issue: issueOf(queued!) };
    });
  }
}
