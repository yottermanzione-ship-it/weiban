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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique('companion_user_character_idx').on(t.userId, t.characterId).nullsNotDistinct()],
);

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
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
