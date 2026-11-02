import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, lte, ne, or } from 'drizzle-orm';
import { Id, Timestamp, type IdentityAccountStatusPort, type Tx } from '@weiban/contracts';
import {
  AppError,
  asDbTx,
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
  adultBoundaryStates,
  replyPlans,
  memories,
  memoryStates,
  simulationStates,
  dailyEvents,
  moodStates,
  healthCareLedger,
  proactivePlans,
  userChatActivity,
  groupCompanionSettings,
  groupSelfChats,
  groupInvites,
  groupReplyPlans,
} from '../infra/db/schema.js';
import { USER_BATCH_DELAY_MS } from '../domain/reply-rules.js';
import {
  REPLY_WAIT_MAX_MS,
  RETRYABLE_WAIT_FAILURES,
  retryableWait,
} from '../domain/reply-delivery.js';
export const GENERATE_REPLY_JOB = 'ai.generate_reply';
/** T-20261103e：等待中回复的定时巡检。 */
export const SWEEP_WAITING_REPLIES_JOB = 'ai.sweep_waiting_replies';
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
/** T-066 迁移 0038 的表（都按 user_id 归属）。 */
const T066_TABLES = [
  'memory_sharing_settings',
  'chat_visits',
  'joint_events',
  'moments_plans',
  'card_referrals',
  // T-072：P-45 静默、来电记录
  'user_quiet_states',
  'call_attempts',
  // T-082：领养提议（一次）、名场面评估记录
  'pet_proposals',
  'moment_card_attempts',
  // T-090：行为规划决策记录
  'planning_decisions',
  'character_self_reports',
  'pending_anniversary_letters',
  'quirk_actions',
  // v5 角色生态 v1（迁移 0109、0110）
  'ecology_settings',
  'ecology_character_settings',
  'ecology_runs',
  'ecology_profiles',
  // H2（迁移 0129）：切出私密模式的整理任务
  'private_digests',
  // H3（迁移 0130）：图片描述存档
  'image_captions',
  'weibo_deliveries',
  'shared_episode_states',
  'shared_episode_months',
  'shared_episodes',
  'call_memory_jobs',
  'group_memory_states',
] as const;
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
    // A new message must never wait behind a deliberate cold-shoulder delay, especially a plea for help.
    if (input.kind === 'message')
      await tx.query(
        `UPDATE ai_runtime.reply_plans SET status='cancelled', input_ciphertext=NULL,
          result_ciphertext=NULL, lease_id=NULL, lease_until=NULL
         WHERE user_id=$1 AND conversation_id=$2 AND next_bubble=0
           AND status IN ('generating','sending') AND id IN (
             SELECT plan_id FROM ai_runtime.quirk_actions WHERE user_id=$1
             AND kind IN ('read_delay','shy_typing')
           )`,
        [input.userId, input.conversationId],
      );
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
  /**
   * T-20261103e：确定性失败直接作废，failure 记原因（如 db_23514）。只动还在进行中的计划；
   * 已发出的气泡不受影响，作废后也不会再发。返回是否真的改了。
   */
  async fail(id: string, reason: string): Promise<boolean> {
    const rows = await this.db.db
      .update(replyPlans)
      .set({
        status: 'cancelled',
        failure: reason,
        inputCiphertext: null,
        resultCiphertext: null,
        leaseId: null,
        leaseUntil: null,
      })
      .where(
        and(eq(replyPlans.id, id), inArray(replyPlans.status, ['queued', 'generating', 'sending'])),
      )
      .returning({ id: replyPlans.id });
    return rows.length > 0;
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
    for (const row of rows) await this.requeueLatestWaiting(row.userId, row.conversationId);
    if (rows.length === 200)
      await this.jobs.send('ai.recover_replies', userId ? { userId } : {}, {
        retryLimit: 10,
        retryBackoff: true,
      });
  }
  /**
   * T-20261103e 定时巡检（每 5 分钟）：模型临时不可用而等待的回复，退避重试，最长等 6 小时。
   * 1. 可重试类等待、用户消息已超过 6 小时的：作废（failure = wait_expired），不再回复；
   * 2. 每个会话看最新的 waiting：属于可重试类、到了重试时间（due_at，按已恢复次数退避）、没超时的，
   *    复用 recover 的做法——只恢复最新批次、旧 waiting 一起取消、retry_epoch + 1（换新的幂等键）。
   * 积分不足、没选模型这类要用户自己处理的等待不碰：会话最新批次是这类时整段跳过，仍由原触发点恢复。
   */
  async sweepWaiting(): Promise<{ expired: number; recovered: number }> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - REPLY_WAIT_MAX_MS);
    const retryable = [...RETRYABLE_WAIT_FAILURES];
    const expired = await this.db.db
      .update(replyPlans)
      .set({
        status: 'cancelled',
        failure: 'wait_expired',
        inputCiphertext: null,
        resultCiphertext: null,
        leaseId: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(replyPlans.status, 'waiting'),
          inArray(replyPlans.failure, retryable),
          lt(replyPlans.createdAt, cutoff),
        ),
      )
      .returning({ id: replyPlans.id });
    const candidates = await this.db.query<{ user_id: string; conversation_id: string }>(
      `SELECT user_id, conversation_id FROM (
         SELECT DISTINCT ON (user_id, conversation_id) user_id, conversation_id, failure, due_at, created_at
         FROM ai_runtime.reply_plans WHERE status='waiting'
         ORDER BY user_id, conversation_id, trigger_seq DESC, created_at DESC
       ) latest
       WHERE failure = ANY($1::text[]) AND due_at <= $2 AND created_at >= $3
       LIMIT 200`,
      [retryable, now, cutoff],
    );
    let recovered = 0;
    for (const c of candidates.rows)
      if (
        await this.requeueLatestWaiting(
          c.user_id,
          c.conversation_id,
          (row) => retryableWait(row.failure) && row.dueAt <= now && row.createdAt >= cutoff,
        )
      )
        recovered++;
    if (expired.length || recovered)
      new Logger(ReplyPlanStore.name).log({
        code: 'ai_reply_wait_sweep',
        expired: expired.length,
        recovered,
      });
    return { expired: expired.length, recovered };
  }
  /**
   * 每个会话只恢复最新批次，旧 waiting 一起取消（账号不可用时全部取消、不恢复）。
   * 在会话锁里重新找最新的 waiting；只取消不比它新的，选出之后才进入等待的新批次不会被误取消。
   * accept（巡检用）：最新批次不符合条件时整段不动。返回是否恢复了一个批次。
   */
  private async requeueLatestWaiting(
    userId: string,
    conversationId: string,
    accept?: (row: ReplyPlan) => boolean,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const active = await this.lock(tx, userId, conversationId);
      const [latest] = await tx.db
        .select()
        .from(replyPlans)
        .where(
          and(
            eq(replyPlans.userId, userId),
            eq(replyPlans.conversationId, conversationId),
            eq(replyPlans.status, 'waiting'),
          ),
        )
        .orderBy(desc(replyPlans.triggerSeq), desc(replyPlans.createdAt))
        .limit(1)
        .for('update');
      if (!latest || (accept && !accept(latest))) return false;
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
            eq(replyPlans.conversationId, conversationId),
            eq(replyPlans.userId, userId),
            eq(replyPlans.status, 'waiting'),
            active
              ? and(ne(replyPlans.id, latest.id), lte(replyPlans.triggerSeq, latest.triggerSeq))
              : undefined,
          ),
        );
      if (!active) return false;
      const [updated] = await tx.db
        .update(replyPlans)
        .set({
          status: 'queued',
          inputCiphertext: null,
          retryEpoch: latest.retryEpoch + 1,
          dueAt: this.clock.now(),
        })
        .where(and(eq(replyPlans.id, latest.id), eq(replyPlans.status, 'waiting')))
        .returning();
      if (updated) await this.schedule(tx, latest.id, this.clock.now());
      return !!updated;
    });
  }
  async purgeTrial(
    transaction: Tx,
    input: { userId: string; characterId: string; conversationId: string },
  ): Promise<void> {
    const tx = asDbTx(transaction);
    await tx.db
      .delete(adultBoundaryStates)
      .where(
        and(
          eq(adultBoundaryStates.userId, input.userId),
          eq(adultBoundaryStates.conversationId, input.conversationId),
          eq(adultBoundaryStates.characterId, input.characterId),
        ),
      );
    await tx.db
      .delete(replyPlans)
      .where(
        and(
          eq(replyPlans.userId, input.userId),
          eq(replyPlans.conversationId, input.conversationId),
          eq(replyPlans.characterId, input.characterId),
        ),
      );
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
      const h = await tx.db
        .delete(healthCareLedger)
        .where(eq(healthCareLedger.userId, userId))
        .returning();
      const i = await tx.db
        .delete(proactivePlans)
        .where(eq(proactivePlans.userId, userId))
        .returning();
      const j = await tx.db
        .delete(userChatActivity)
        .where(eq(userChatActivity.userId, userId))
        .returning();
      const adult = await tx.db
        .delete(adultBoundaryStates)
        .where(eq(adultBoundaryStates.userId, userId))
        .returning();
      return (
        (await tx.db.delete(groupReplyPlans).where(eq(groupReplyPlans.userId, userId)).returning())
          .length +
        adult.length +
        a.length +
        b.length +
        c.length +
        d.length +
        e.length +
        f.length +
        g.length +
        h.length +
        i.length +
        j.length +
        (
          await tx.db
            .delete(groupCompanionSettings)
            .where(eq(groupCompanionSettings.userId, userId))
            .returning()
        ).length +
        (await tx.db.delete(groupSelfChats).where(eq(groupSelfChats.userId, userId)).returning())
          .length +
        (await tx.db.delete(groupInvites).where(eq(groupInvites.userId, userId)).returning())
          .length +
        (await this.purgeT066(tx, userId))
      );
    });
  }
  /** T-066 新表（迁移 0038）的注销清理。 */
  private async purgeT066(tx: DbTx, userId: string): Promise<number> {
    let n = 0;
    for (const table of T066_TABLES)
      n +=
        (await tx.query(`DELETE FROM ai_runtime.${table} WHERE user_id=$1`, [userId])).rowCount ??
        0;
    return n;
  }
  async countUserData(userId: string): Promise<number> {
    const [groupReplies] = await this.db.db
      .select({ n: count() })
      .from(groupReplyPlans)
      .where(eq(groupReplyPlans.userId, userId));
    const [adult] = await this.db.db
      .select({ n: count() })
      .from(adultBoundaryStates)
      .where(eq(adultBoundaryStates.userId, userId));
    let t066 = 0;
    for (const table of T066_TABLES)
      t066 += Number(
        (
          await this.db.query<{ n: string }>(
            `SELECT count(*) n FROM ai_runtime.${table} WHERE user_id=$1`,
            [userId],
          )
        ).rows[0]?.n ?? 0,
      );
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
    const [h] = await this.db.db
      .select({ n: count() })
      .from(healthCareLedger)
      .where(eq(healthCareLedger.userId, userId));
    const [i] = await this.db.db
      .select({ n: count() })
      .from(proactivePlans)
      .where(eq(proactivePlans.userId, userId));
    const [j] = await this.db.db
      .select({ n: count() })
      .from(userChatActivity)
      .where(eq(userChatActivity.userId, userId));
    const [k] = await this.db.db
      .select({ n: count() })
      .from(groupCompanionSettings)
      .where(eq(groupCompanionSettings.userId, userId));
    const [l] = await this.db.db
      .select({ n: count() })
      .from(groupSelfChats)
      .where(eq(groupSelfChats.userId, userId));
    const [m] = await this.db.db
      .select({ n: count() })
      .from(groupInvites)
      .where(eq(groupInvites.userId, userId));
    return (
      t066 +
      (groupReplies?.n ?? 0) +
      (adult?.n ?? 0) +
      (k?.n ?? 0) +
      (l?.n ?? 0) +
      (m?.n ?? 0) +
      (i?.n ?? 0) +
      (j?.n ?? 0) +
      (h?.n ?? 0) +
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
