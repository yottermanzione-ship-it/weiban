import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  MODEL_TASK_OUTCOME_PORT,
  type BillingReadPort,
  type ContactsReadPort,
  type ModelTaskOutcomePort,
} from '@weiban/contracts';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import {
  DATABASE,
  CLOCK,
  JOB_QUEUE,
  EVENT_BUS,
  modelTaskKey,
  type Clock,
  type Database,
  type JobQueue,
  type EventBus,
} from '../../../platform/index.js';
import { factJobKey, memoryFundingCheckAt } from '../domain/memory-funding.js';
import { ReplyPlanStore } from './plan-store.js';

const RECHECK = 'ai.recheck_memory_funding';

@Injectable()
export class MemoryFundingRecovery implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(ReplyPlanStore) private readonly plans: ReplyPlanStore,
    @Inject(MODEL_TASK_OUTCOME_PORT) private readonly outcomes: ModelTaskOutcomePort,
  ) {}

  async onModuleInit() {
    await this.jobs.work<{ userId: string }>(RECHECK, (j) => this.check(j.data.userId));
    this.bus.subscribe({
      consumer: 'ai.memory_funding_restored',
      eventType: 'billing.balance_restored',
      handle: async (event, tx) => {
        const { userId } = event.payload;
        const pending = await tx.query(
          `SELECT 1 WHERE EXISTS(SELECT 1 FROM ai_runtime.memory_states WHERE user_id=$1 AND fact_wait_reason='insufficient_balance' AND fact_trigger_seq>cursor_seq)
         OR EXISTS(SELECT 1 FROM ai_runtime.chat_summary_states s JOIN ai_runtime.memory_states p ON p.id=s.parent_id
           WHERE p.user_id=$1 AND s.last_failure='insufficient_balance' AND s.target_seq>s.covered_seq)
         OR EXISTS(SELECT 1 FROM ai_runtime.group_memory_states WHERE user_id=$1 AND wait_reason='insufficient_balance' AND pending_count>0)`,
          [userId],
        );
        if (pending.rowCount)
          await this.jobs.send(RECHECK, { userId }, { tx, singletonKey: userId, retryLimit: 2 });
      },
    });
  }

  async sweepDue() {
    const due = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM (
        SELECT user_id,retry_after AS due FROM ai_runtime.group_memory_states WHERE wait_reason='insufficient_balance' AND pending_count>0 AND retry_after<=$1
        UNION ALL SELECT user_id,retry_after FROM ai_runtime.memory_states WHERE fact_wait_reason='insufficient_balance' AND fact_trigger_seq>cursor_seq AND retry_after<=$1
        UNION ALL SELECT p.user_id,s.retry_after FROM ai_runtime.chat_summary_states s JOIN ai_runtime.memory_states p ON p.id=s.parent_id
          WHERE s.last_failure='insufficient_balance' AND s.target_seq>s.covered_seq AND s.retry_after<=$1
      ) w GROUP BY user_id ORDER BY min(due),user_id LIMIT 50`,
      [this.clock.now()],
    );
    for (const row of due.rows) await this.check(row.user_id);
  }

  async check(userId: string) {
    // A stale event can arrive after another charge spent the replenished balance.
    const ready = (await this.billing.getSpendStatus(userId)).availableMicros > 0;
    const reason = ready ? null : 'insufficient_balance';
    const at = ready
      ? this.clock.now()
      : memoryFundingCheckAt('insufficient_balance', this.clock.now());
    await this.db.transaction(async (tx) => {
      if (!(await this.plans.lock(tx, userId))) return;
      const params = [userId, reason, at];
      const facts = await tx.query<{
        id: string;
        revision: number;
        cursor_seq: string;
        character_id: string;
        conversation_id: string;
      }>(
        "UPDATE ai_runtime.memory_states SET fact_wait_reason=$2,retry_after=$3 WHERE user_id=$1 AND fact_wait_reason='insufficient_balance' AND fact_trigger_seq>cursor_seq RETURNING id,revision,cursor_seq,character_id,conversation_id",
        params,
      );
      const summaries = await tx.query<{
        id: string;
        version: number;
        covered_seq: string;
        partial_offset: number;
      }>(
        "UPDATE ai_runtime.chat_summary_states s SET last_failure=$2,retry_after=$3 FROM ai_runtime.memory_states p WHERE s.parent_id=p.id AND p.user_id=$1 AND s.last_failure='insufficient_balance' AND s.target_seq>s.covered_seq RETURNING s.id,s.version,s.covered_seq,s.partial_offset",
        params,
      );
      const groups = await tx.query<{ id: string; cursor_seq: string }>(
        "UPDATE ai_runtime.group_memory_states SET wait_reason=$2,retry_after=$3 WHERE user_id=$1 AND wait_reason='insufficient_balance' AND pending_count>0 RETURNING id,cursor_seq",
        params,
      );
      const tasks = [
        ...facts.rows.map((s) => `facts:${s.id}:${s.revision}:${s.cursor_seq}`),
        ...summaries.rows.map(
          (s) => `summary:${s.id}:${s.version}:${s.covered_seq}:${s.partial_offset}`,
        ),
        ...groups.rows.map((s) => `group-memory:${s.id}:${s.cursor_seq}`),
      ];
      for (const source of tasks)
        await this.outcomes.record(
          {
            userId,
            taskKey: modelTaskKey(userId, source),
            purpose: 'memory',
            state: 'deferred',
            reason: reason ?? 'memory_funding_ready',
            retryAt: at.toISOString(),
          },
          tx,
        );
      if (!ready) return;
      for (const summary of summaries.rows)
        await this.jobs.sendCoalesced(
          'ai.compact_chat',
          { id: summary.id },
          { tx, singletonKey: 'chat-summary:' + summary.id, retryLimit: 0 },
        );
      for (const group of groups.rows)
        await this.jobs.sendCoalesced(
          'ai.extract_group_memory',
          { stateId: group.id },
          { tx, singletonKey: group.id, retryLimit: 2 },
        );
      for (const fact of facts.rows) {
        const epoch = await this.contacts.getActiveContactEpoch(userId, fact.character_id, tx);
        if (epoch)
          await this.jobs.sendCoalesced(
            'ai.extract_memory',
            {
              userId,
              characterId: fact.character_id,
              conversationId: fact.conversation_id,
              epoch: epoch.version,
              urgent: true,
            },
            {
              tx,
              singletonKey: factJobKey(userId, fact.conversation_id, epoch.version),
              retryLimit: 0,
            },
          );
      }
    });
  }
}
