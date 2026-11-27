import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, lte, or } from 'drizzle-orm';
import {
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
} from '../../../platform/index.js';
import { groupReplyPlans } from '../infra/db/schema.js';
import { ReplyPlanStore } from './plan-store.js';

export type GroupReplyPlan = typeof groupReplyPlans.$inferSelect & { batchFirstSeq?: number };
const JOB = 'ai.group_turn';
const LEASE_MS = 15 * 60_000;

/** Lease fencing and encrypted checkpoints; posting uses the original ordinal key. */
@Injectable()
export class GroupReplyStore {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(ReplyPlanStore) private readonly owner: ReplyPlanStore,
  ) {}

  /** 用户 / 会话咨询锁（与 ReplyPlanStore.lock 同一把）；账号不再有效时返回 false。 */
  lockOwner(tx: DbTx, userId: string, conversationId: string): Promise<boolean> {
    return this.owner.lock(tx, userId, conversationId);
  }

  window(userId: string, conversationId: string, tx: DbTx) {
    return this.owner.replyWindow(userId, conversationId, tx);
  }
  async enqueue(
    tx: DbTx,
    input: Pick<
      GroupReplyPlan,
      'userId' | 'conversationId' | 'triggerMessageId' | 'triggerSeq' | 'scope'
    >,
  ): Promise<void> {
    if (!(await this.owner.lock(tx, input.userId, input.conversationId))) return;
    await tx.db
      .update(groupReplyPlans)
      .set({ status: 'cancelled', updatedAt: this.clock.now() })
      .where(
        and(
          eq(groupReplyPlans.conversationId, input.conversationId),
          eq(groupReplyPlans.status, 'queued'),
          lt(groupReplyPlans.triggerSeq, input.triggerSeq),
        ),
      );
    await tx.db
      .insert(groupReplyPlans)
      .values({
        ...input,
        id: newId(),
        status: 'queued',
        createdAt: this.clock.now(),
        updatedAt: this.clock.now(),
      })
      .onConflictDoNothing();
  }

  async claim(userId: string, conversationId: string): Promise<GroupReplyPlan | null> {
    const [first] = await this.db.db
      .select()
      .from(groupReplyPlans)
      .where(
        and(
          eq(groupReplyPlans.userId, userId),
          eq(groupReplyPlans.conversationId, conversationId),
          or(
            eq(groupReplyPlans.status, 'queued'),
            and(
              eq(groupReplyPlans.status, 'generating'),
              lte(groupReplyPlans.leaseUntil, this.clock.now()),
            ),
          ),
        ),
      )
      .orderBy(desc(groupReplyPlans.triggerSeq))
      .limit(1);
    if (!first) return null;
    return this.db.transaction(async (tx) => {
      if (!(await this.owner.lock(tx, first.userId, first.conversationId))) return null;
      const [row] = await tx.db
        .select()
        .from(groupReplyPlans)
        .where(eq(groupReplyPlans.id, first.id))
        .for('update');
      if (
        !row ||
        !['queued', 'generating'].includes(row.status) ||
        (row.leaseUntil && row.leaseUntil.getTime() > this.clock.nowMs())
      )
        return null;
      const window = await this.owner.replyWindow(row.userId, row.conversationId, tx);
      if (window?.partial) return null;
      if (window?.quietUntil && window.quietUntil > this.clock.now()) {
        await this.schedule(row, tx, window.quietUntil);
        return null;
      }
      const [claimed] = await tx.db
        .update(groupReplyPlans)
        .set({
          status: 'generating',
          leaseId: newId(),
          leaseUntil: new Date(this.clock.nowMs() + LEASE_MS),
          updatedAt: this.clock.now(),
        })
        .where(eq(groupReplyPlans.id, row.id))
        .returning();
      return claimed
        ? {
            ...claimed,
            batchFirstSeq:
              window?.latest?.seq === claimed.triggerSeq
                ? window.latest.firstSeq
                : claimed.triggerSeq,
          }
        : null;
    });
  }

  async open<T>(row: GroupReplyPlan, part: 'plan' | 'input' | 'result'): Promise<T | null> {
    const cipher = row[`${part}Ciphertext`];
    if (!cipher) return null;
    const plain = await this.crypto.open(row.userId, `ai:group-plan:${row.id}:${part}`, cipher);
    try {
      return JSON.parse(plain.toString('utf8')) as T;
    } finally {
      plain.fill(0);
    }
  }

  async checkpoint(
    row: GroupReplyPlan,
    values: {
      plan?: unknown;
      input?: unknown;
      result?: unknown;
      nextOrdinal?: number;
      status?: 'waiting' | 'done' | 'cancelled';
    },
  ): Promise<GroupReplyPlan | null> {
    return this.db.transaction(async (tx) => {
      if (!(await this.owner.lock(tx, row.userId, row.conversationId))) return null;
      const [current] = await tx.db
        .select()
        .from(groupReplyPlans)
        .where(eq(groupReplyPlans.id, row.id))
        .for('update');
      if (
        !current ||
        current.status !== 'generating' ||
        current.leaseId !== row.leaseId ||
        !current.leaseUntil ||
        current.leaseUntil.getTime() <= this.clock.nowMs()
      )
        return null;
      const patch: Partial<GroupReplyPlan> = {
        updatedAt: this.clock.now(),
        leaseUntil: new Date(this.clock.nowMs() + LEASE_MS),
      };
      for (const part of ['plan', 'input', 'result'] as const) {
        if (values[part] !== undefined)
          patch[`${part}Ciphertext`] =
            values[part] === null
              ? null
              : await this.crypto.seal(
                  row.userId,
                  `ai:group-plan:${row.id}:${part}`,
                  JSON.stringify(values[part]),
                  tx,
                );
      }
      if (values.nextOrdinal !== undefined) patch.nextOrdinal = values.nextOrdinal;
      if (values.status) {
        patch.status = values.status;
        patch.leaseId = null;
        patch.leaseUntil = null;
        if (values.status !== 'waiting')
          patch.planCiphertext = patch.inputCiphertext = patch.resultCiphertext = null;
      }
      const [updated] = await tx.db
        .update(groupReplyPlans)
        .set(patch)
        .where(eq(groupReplyPlans.id, row.id))
        .returning();
      return updated ?? null;
    });
  }

  async recover(userId?: string): Promise<void> {
    const rows = await this.db.db
      .select()
      .from(groupReplyPlans)
      .where(
        and(
          eq(groupReplyPlans.status, 'waiting'),
          userId ? eq(groupReplyPlans.userId, userId) : undefined,
        ),
      )
      .limit(200);
    for (const row of rows)
      await this.db.transaction(async (tx) => {
        if (!(await this.owner.lock(tx, row.userId, row.conversationId))) return;
        const [current] = await tx.db
          .select()
          .from(groupReplyPlans)
          .where(eq(groupReplyPlans.id, row.id))
          .for('update');
        if (!current || current.status !== 'waiting') return;
        const [updated] = await tx.db
          .update(groupReplyPlans)
          .set({
            status: 'queued',
            retryEpoch: current.retryEpoch + 1,
            updatedAt: this.clock.now(),
          })
          .where(and(eq(groupReplyPlans.id, row.id), eq(groupReplyPlans.status, 'waiting')))
          .returning();
        if (updated) await this.schedule(updated, tx);
      });
    if (rows.length === 200)
      await this.jobs.send(
        'ai.recover_replies',
        { userId, target: 'group' },
        {
          retryLimit: 10,
          retryBackoff: true,
        },
      );
  }

  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select({
        userId: groupReplyPlans.userId,
        conversationId: groupReplyPlans.conversationId,
        triggerMessageId: groupReplyPlans.triggerMessageId,
        triggerSeq: groupReplyPlans.triggerSeq,
      })
      .from(groupReplyPlans)
      .where(
        or(
          eq(groupReplyPlans.status, 'queued'),
          and(
            eq(groupReplyPlans.status, 'generating'),
            lte(groupReplyPlans.leaseUntil, this.clock.now()),
          ),
        ),
      )
      .limit(200);
    for (const row of rows) await this.schedule(row);
  }

  async cancelConversation(tx: DbTx, conversationId: string): Promise<void> {
    await tx.db
      .update(groupReplyPlans)
      .set({
        status: 'cancelled',
        planCiphertext: null,
        inputCiphertext: null,
        resultCiphertext: null,
        leaseId: null,
        leaseUntil: null,
        updatedAt: this.clock.now(),
      })
      .where(
        and(
          eq(groupReplyPlans.conversationId, conversationId),
          inArray(groupReplyPlans.status, ['queued', 'generating', 'waiting']),
        ),
      );
  }

  private schedule(
    row: Pick<GroupReplyPlan, 'userId' | 'conversationId' | 'triggerMessageId' | 'triggerSeq'>,
    tx?: DbTx,
    startAfter?: Date,
  ) {
    return this.jobs.sendCoalesced(
      JOB,
      {
        userId: row.userId,
        conversationId: row.conversationId,
        triggerMessageId: row.triggerMessageId,
        triggerSeq: row.triggerSeq,
      },
      { tx, startAfter, singletonKey: row.conversationId, retryLimit: 10, retryBackoff: true },
    );
  }
}
