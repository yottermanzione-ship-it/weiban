import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lte, or } from 'drizzle-orm';
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

export type GroupReplyPlan = typeof groupReplyPlans.$inferSelect;
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

  async enqueue(
    tx: DbTx,
    input: Pick<
      GroupReplyPlan,
      'userId' | 'conversationId' | 'triggerMessageId' | 'triggerSeq' | 'scope'
    >,
  ): Promise<void> {
    if (!(await this.owner.lock(tx, input.userId, input.conversationId))) return;
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

  async claim(triggerMessageId: string): Promise<GroupReplyPlan | null> {
    const [first] = await this.db.db
      .select()
      .from(groupReplyPlans)
      .where(eq(groupReplyPlans.triggerMessageId, triggerMessageId));
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
      return claimed ?? null;
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
      await this.jobs.send('ai.recover_replies', userId ? { userId } : {}, {
        retryLimit: 10,
        retryBackoff: true,
      });
  }

  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select()
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

  private schedule(row: GroupReplyPlan, tx?: DbTx) {
    return this.jobs.send(
      JOB,
      {
        userId: row.userId,
        conversationId: row.conversationId,
        triggerMessageId: row.triggerMessageId,
        triggerSeq: row.triggerSeq,
      },
      { ...(tx ? { tx } : {}), retryLimit: 10, retryBackoff: true },
    );
  }
}
