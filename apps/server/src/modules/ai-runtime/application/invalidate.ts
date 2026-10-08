import { and, eq, inArray } from 'drizzle-orm';
import type { DbTx } from '../../../platform/index.js';
import { replyPlans } from '../infra/db/schema.js';
import type { ReplyPlanStore } from './plan-store.js';
/** 清除模型快照和租约，旧调用写回时lease不再匹配；已发部分气泡的计划取消。 */
export async function invalidateReplyPlans(
  tx: DbTx,
  store: ReplyPlanStore,
  userId: string,
  characterId: string,
): Promise<void> {
  const rows = await tx.db
    .select()
    .from(replyPlans)
    .where(
      and(
        eq(replyPlans.userId, userId),
        eq(replyPlans.characterId, characterId),
        inArray(replyPlans.status, ['queued', 'generating', 'waiting', 'sending']),
      ),
    )
    .for('update');
  for (const row of rows) {
    const status = row.nextBubble > 0 ? 'cancelled' : 'queued';
    await tx.db
      .update(replyPlans)
      .set({
        status,
        inputCiphertext: null,
        resultCiphertext: null,
        leaseId: null,
        leaseUntil: null,
        retryEpoch: row.retryEpoch + 1,
        dueAt: store.clock.now(),
      })
      .where(eq(replyPlans.id, row.id));
    if (status === 'queued') await store.schedule(tx, row.id, store.clock.now());
  }
}
