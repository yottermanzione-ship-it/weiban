import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  boolean,
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
export const aiRuntimeSchema = pgSchema('ai_runtime');
/** null characterId 表示用户全局默认；单独设置整份快照不随默认变化。 */
export const companionSettings = aiRuntimeSchema.table(
  'companion_settings',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id'),
    instantReply: boolean('instant_reply').notNull(),
    splitBubbles: boolean('split_bubbles').notNull(),
    personaFit: integer('persona_fit').notNull().default(3),
    scenarioMode: text('scenario_mode').notNull().default('daily'),
    proactiveMessages: boolean('proactive_messages').notNull().default(true),
    proactiveFrequency: text('proactive_frequency').notNull().default('medium'),
    proactiveCalls: boolean('proactive_calls').notNull().default(false),
    dailyLife: boolean('daily_life').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('companion_user_character_idx').on(t.userId, t.characterId).nullsNotDistinct(),
    check('companion_persona_fit', sql`${t.personaFit} BETWEEN 1 AND 5`),
    check('companion_mode', sql`${t.scenarioMode} IN ('daily','tsundere','romance','adult')`),
    check('companion_frequency', sql`${t.proactiveFrequency} IN ('low','medium','high')`),
  ],
);

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
/** 不在明文列保存记忆内容、来源消息、私密类别或共享标签。 */
export const memories = aiRuntimeSchema.table(
  'memories',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    clientId: uuid('client_id'),
    scope: text('scope').notNull(),
    ciphertext: bytes('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('memory_client_idx').on(t.userId, t.characterId, t.clientId),
    index('memory_owner_idx').on(t.userId, t.characterId, t.conversationId, t.id),
    check('memory_scope', sql`${t.scope} IN ('normal','adult')`),
  ],
);
/** 删除屏障按会话seq保守截断旧原文；摘要与来源清单加密。 */
export const memoryStates = aiRuntimeSchema.table(
  'memory_states',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    revision: integer('revision').notNull().default(0),
    pendingCount: integer('pending_count').notNull().default(0),
    retryAfter: timestamp('retry_after', { withTimezone: true }),
    barrierSeq: bigint('barrier_seq', { mode: 'number' }).notNull().default(0),
    cursorSeq: bigint('cursor_seq', { mode: 'number' }).notNull().default(0),
    summaryCiphertext: bytes('summary_ciphertext'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('memory_state_owner_idx').on(t.userId, t.characterId, t.conversationId),
    check(
      'memory_state_counters',
      sql`${t.pendingCount} >= 0 AND ${t.revision} >= 0 AND ${t.barrierSeq} >= 0 AND ${t.cursorSeq} >= 0`,
    ),
  ],
);
/** 计划记录仅ID、状态与时序；模型输入和已生成气泡按用户DEK加密。 */
export const replyPlans = aiRuntimeSchema.table(
  'reply_plans',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    triggerId: uuid('trigger_id').notNull(),
    triggerSeq: bigint('trigger_seq', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    inputCiphertext: bytes('input_ciphertext'),
    resultCiphertext: bytes('result_ciphertext'),
    nextBubble: integer('next_bubble').notNull().default(0),
    retryEpoch: integer('retry_epoch').notNull().default(0),
    failure: text('failure'),
    careUntil: timestamp('care_until', { withTimezone: true }),
  },
  (t) => [
    check(
      'reply_plan_status',
      sql`${t.status} IN ('queued','generating','waiting','sending','done','cancelled')`,
    ),
    check('reply_plan_kind', sql`${t.kind} IN ('message','greeting')`),
    check(
      'reply_plan_counters',
      sql`${t.triggerSeq} >= 0 AND ${t.triggerSeq} <= 9007199254740991 AND ${t.nextBubble} >= 0 AND ${t.nextBubble} <= 4 AND ${t.retryEpoch} >= 0`,
    ),
    unique('reply_trigger_idx').on(t.userId, t.triggerId),
    index('reply_due_idx').on(t.status, t.dueAt),
    index('reply_conversation_idx').on(t.conversationId, t.triggerSeq),
  ],
);
