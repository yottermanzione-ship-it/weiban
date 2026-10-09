import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lte, ne, or } from 'drizzle-orm';
import { Id, Timestamp, type IdentityAccountStatusPort } from '@weiban/contracts';
import {
  AppError,
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
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import {
  companionSettings,
  replyPlans,
  memories,
  memoryStates,
  simulationStates,
  dailyEvents,
  moodStates,
} from '../infra/db/schema.js';
import { USER_BATCH_DELAY_MS } from '../domain/reply-rules.js';
export const GENERATE_REPLY_JOB = 'ai.generate_reply';
export type ReplyPlan = typeof replyPlans.$inferSelect;
export interface EnqueueReply {
  userId: string;
  characterId: string;
  conversationId: string;
  triggerId: string;
  triggerSeq: number;
  kind: 'message' | 'greeting';
  triggeredAt?: string;
}
@Injectable()
export class ReplyPlanStore {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) readonly accounts: IdentityAccountStatusPort,
  ) {}
  async lock(tx: DbTx, userId: string, conversationId?: string): Promise<boolean> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
      userId,
    ]);
    if (conversationId)
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:conversation:' || $1,0))",
        [conversationId],
      );
    return (await this.accounts.getAccountStatus(userId, tx)) === 'active';
  }
  async enqueue(tx: DbTx, input: EnqueueReply): Promise<void> {
    for (const id of [input.userId, input.characterId, input.conversationId, input.triggerId])
      if (!Id.safeParse(id).success) throw new AppError('bad_request', '无效回复任务');
    if (!(await this.lock(tx, input.userId, input.conversationId))) return;
    if (input.triggeredAt && !Timestamp.safeParse(input.triggeredAt).success)
      throw new AppError('bad_request', '无效触发时间');
    const dueAt = new Date(
      this.clock.nowMs() + (input.kind === 'message' ? USER_BATCH_DELAY_MS : 0),
    );
    const [row] = await tx.db
      .insert(replyPlans)
      .values({
        id: newId(),
        ...input,
        status: 'queued',
        dueAt,
        createdAt: input.triggeredAt ? new Date(input.triggeredAt) : this.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (row) await this.schedule(tx, row.id, dueAt);
  }
  schedule(tx: DbTx, planId: string, dueAt: Date) {
    return this.jobs.send(
      GENERATE_REPLY_JOB,
      { planId },
      { tx, startAfter: dueAt, retryLimit: 10, retryBackoff: true },
    );
  }
  async claim(id: string): Promise<ReplyPlan | null> {
    const first = await this.get(id);
    if (!first) return null;
    return this.db.transaction(async (tx) => {
      if (!(await this.lock(tx, first.userId, first.conversationId))) return null;
      const [row] = await tx.db
        .select()
        .from(replyPlans)
        .where(eq(replyPlans.id, id))
        .for('update');
      if (
        !row ||
        !['queued', 'generating', 'sending'].includes(row.status) ||
        row.dueAt > this.clock.now()
      )
        return null;
      if (row.status === 'sending') return row;
      if (row.status === 'generating' && row.leaseUntil && row.leaseUntil > this.clock.now())
        return null;
      const all = await tx.db
        .select()
        .from(replyPlans)
        .where(
          and(
            eq(replyPlans.conversationId, row.conversationId),
            inArray(replyPlans.status, ['queued', 'generating', 'sending']),
          ),
        );
      if (all.some((p) => p.id !== id && ['generating', 'sending'].includes(p.status))) {
        await this.schedule(tx, id, new Date(this.clock.nowMs() + 2000));
        return null;
      }
      const newest = all
        .filter((p) => p.status === 'queued')
        .sort(
          (a, b) => b.triggerSeq - a.triggerSeq || b.createdAt.getTime() - a.createdAt.getTime(),
        )[0];
      if (row.status === 'queued' && newest?.id !== id) {
        await tx.db
          .update(replyPlans)
          .set({ status: 'cancelled', inputCiphertext: null, resultCiphertext: null })
          .where(eq(replyPlans.id, id));
        return null;
      }
      await tx.db
        .update(replyPlans)
        .set({ status: 'cancelled', inputCiphertext: null, resultCiphertext: null })
        .where(
          and(
            eq(replyPlans.conversationId, row.conversationId),
            eq(replyPlans.status, 'queued'),
            ne(replyPlans.id, id),
          ),
        );
      const [claimed] = await tx.db
        .update(replyPlans)
        .set({
          status: 'generating',
          leaseId: newId(),
          leaseUntil: new Date(this.clock.nowMs() + 120000),
        })
        .where(eq(replyPlans.id, id))
        .returning();
      return claimed ?? null;
    });
  }
  async get(id: string): Promise<ReplyPlan | null> {
    const [row] = await this.db.db.select().from(replyPlans).where(eq(replyPlans.id, id));
    return row ?? null;
  }
  async seal(tx: DbTx, row: ReplyPlan, part: 'input' | 'result', value: unknown): Promise<Buffer> {
    return this.crypto.seal(row.userId, `ai:plan:${row.id}:${part}`, JSON.stringify(value), tx);
  }
  async open(row: ReplyPlan, part: 'input' | 'result'): Promise<unknown> {
    const cipher = part === 'input' ? row.inputCiphertext : row.resultCiphertext;
    if (!cipher) throw Error('回复计划缺少密文');
    const plain = await this.crypto.open(row.userId, `ai:plan:${row.id}:${part}`, cipher);
    try {
      return JSON.parse(plain.toString('utf8')) as unknown;
    } finally {
      plain.fill(0);
    }
  }
  async cancel(id: string): Promise<void> {
    await this.db.db
      .update(replyPlans)
      .set({
        status: 'cancelled',
        inputCiphertext: null,
        resultCiphertext: null,
        leaseId: null,
        leaseUntil: null,
      })
      .where(eq(replyPlans.id, id));
  }
  async reconcile(): Promise<void> {
    const rows = await this.db.db
      .select()
      .from(replyPlans)
      .where(
        or(
          and(
            inArray(replyPlans.status, ['queued', 'sending']),
            lte(replyPlans.dueAt, this.clock.now()),
          ),
          and(eq(replyPlans.status, 'generating'), lte(replyPlans.leaseUntil, this.clock.now())),
        ),
      )
      .limit(200);
    for (const row of rows)
      await this.jobs.send(
        GENERATE_REPLY_JOB,
        { planId: row.id },
        { retryLimit: 10, retryBackoff: true },
      );
  }
  async recover(userId?: string): Promise<void> {
    if (userId && !Id.safeParse(userId).success) throw new AppError('bad_request', '无效恢复任务');
    // 每个会话只恢复最新批次，旧waiting一起取消；超过一页以持久任务继续，不遗漏后面的用户。
    const rows = await this.db.db
      .selectDistinctOn([replyPlans.userId, replyPlans.conversationId])
      .from(replyPlans)
      .where(
        and(eq(replyPlans.status, 'waiting'), userId ? eq(replyPlans.userId, userId) : undefined),
      )
      .orderBy(
        replyPlans.userId,
        replyPlans.conversationId,
        desc(replyPlans.triggerSeq),
        desc(replyPlans.createdAt),
      )
      .limit(200);
    for (const row of rows)
      await this.db.transaction(async (tx) => {
        const active = await this.lock(tx, row.userId, row.conversationId);
        await tx.db
          .update(replyPlans)
          .set({
            status: 'cancelled',
            inputCiphertext: null,
            resultCiphertext: null,
            leaseId: null,
            leaseUntil: null,
          })
          .where(
            and(
              eq(replyPlans.conversationId, row.conversationId),
              eq(replyPlans.userId, row.userId),
              eq(replyPlans.status, 'waiting'),
              active ? ne(replyPlans.id, row.id) : undefined,
            ),
          );
        if (!active) return;
        const [updated] = await tx.db
          .update(replyPlans)
          .set({
            status: 'queued',
            inputCiphertext: null,
            retryEpoch: row.retryEpoch + 1,
            dueAt: this.clock.now(),
          })
          .where(and(eq(replyPlans.id, row.id), eq(replyPlans.status, 'waiting')))
          .returning();
        if (updated) await this.schedule(tx, row.id, this.clock.now());
      });
    if (rows.length === 200)
      await this.jobs.send('ai.recover_replies', userId ? { userId } : {}, {
        retryLimit: 10,
        retryBackoff: true,
      });
  }
  async purgeUser(userId: string): Promise<number> {
    return await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
        userId,
      ]);
      const a = await tx.db.delete(replyPlans).where(eq(replyPlans.userId, userId)).returning();
      const b = await tx.db
        .delete(companionSettings)
        .where(eq(companionSettings.userId, userId))
        .returning();
      const c = await tx.db.delete(memories).where(eq(memories.userId, userId)).returning();
      const d = await tx.db.delete(memoryStates).where(eq(memoryStates.userId, userId)).returning();
      const e = await tx.db
        .delete(simulationStates)
        .where(eq(simulationStates.userId, userId))
        .returning();
      const f = await tx.db.delete(dailyEvents).where(eq(dailyEvents.userId, userId)).returning();
      const g = await tx.db.delete(moodStates).where(eq(moodStates.userId, userId)).returning();
      return a.length + b.length + c.length + d.length + e.length + f.length + g.length;
    });
  }
  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: count() })
      .from(replyPlans)
      .where(eq(replyPlans.userId, userId));
    const [b] = await this.db.db
      .select({ n: count() })
      .from(companionSettings)
      .where(eq(companionSettings.userId, userId));
    const [c] = await this.db.db
      .select({ n: count() })
      .from(memories)
      .where(eq(memories.userId, userId));
    const [d] = await this.db.db
      .select({ n: count() })
      .from(memoryStates)
      .where(eq(memoryStates.userId, userId));
    const [e] = await this.db.db
      .select({ n: count() })
      .from(simulationStates)
      .where(eq(simulationStates.userId, userId));
    const [f] = await this.db.db
      .select({ n: count() })
      .from(dailyEvents)
      .where(eq(dailyEvents.userId, userId));
    const [g] = await this.db.db
      .select({ n: count() })
      .from(moodStates)
      .where(eq(moodStates.userId, userId));
    return (
      (a?.n ?? 0) +
      (b?.n ?? 0) +
      (c?.n ?? 0) +
      (d?.n ?? 0) +
      (e?.n ?? 0) +
      (f?.n ?? 0) +
      (g?.n ?? 0)
    );
  }
}
