/**
 * proactive 模块的表（PostgreSQL schema `proactive`，SIM-05～09）。
 * 表说明见 docs/backend/proactive.md（T-052 产出）。
 *
 * 改表结构：改这里 → `pnpm --filter @weiban/server db:generate` 生成迁移 → 手写对应的 .down.sql。
 */
import {
  index,
  pgSchema,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from 'drizzle-orm/pg-core';

export const proactiveSchema = pgSchema('proactive');

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * 节日/纪念日清单（SIM-09 第 1 条，管理员维护）。
 * - dateType = 'once'：dateValue 为 YYYY-MM-DD，一次性。
 * - dateType = 'annual'：dateValue 为 MM-DD，每年重复。
 */
export const holidays = proactiveSchema.table(
  'holidays',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** 'once' | 'annual' */
    dateType: text('date_type').notNull(),
    /** YYYY-MM-DD 或 MM-DD */
    dateValue: text('date_value').notNull(),
    /** 是否带恋爱含义（七夕、情人节等） */
    romantic: boolean('romantic').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: tz('created_at').notNull(),
    updatedAt: tz('updated_at').notNull(),
  },
  (t) => [
    index('holidays_enabled_idx').on(t.enabled),
    index('holidays_date_value_idx').on(t.dateType, t.dateValue),
  ],
);

/**
 * 角色日常事件（SIM-01，ai-runtime 写入，后端存储）。
 * 每条对应一件推演生成或公开动态的日常事件。
 * 时间线保留最近 90 天（SIM-11 第 4 条）。
 */
export const dailyEvents = proactiveSchema.table(
  'daily_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 事件所属的用户本地日期（YYYY-MM-DD）。 */
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    /** 大致时间描述，可为空（"上午" / "14:30"）。 */
    eventTime: text('event_time'),
    summary: text('summary').notNull(),
    /** 涉及的另一个角色 ID（关系网中），可为空。 */
    withCharacterId: uuid('with_character_id'),
    /** 心情影响描述，可为空。 */
    moodEffect: text('mood_effect'),
    /** 'simulation' | 'public_feed' */
    source: text('source').notNull(),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [
    index('daily_events_user_char_date_idx').on(t.userId, t.characterId, t.eventDate),
    index('daily_events_user_date_idx').on(t.userId, t.eventDate),
    index('daily_events_created_at_idx').on(t.createdAt),
  ],
);

/**
 * 主动消息每日发送记录（SIM-05 第 4 条，计数与去重）。
 * 每条代表向某用户从某角色实际发出的一次主动消息。
 * 幂等键 = idempotencyKey，防止重复计数。
 */
export const proactiveSentLog = proactiveSchema.table(
  'proactive_sent_log',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 用户本地日期（YYYY-MM-DD），用于每日上限统计。 */
    localDate: date('local_date', { mode: 'string' }).notNull(),
    /** 主动消息理由（SIM-05 第 1 条），供验收抽查。 */
    reason: text('reason').notNull(),
    /** 外部幂等键，同一次调度只记一次。 */
    idempotencyKey: text('idempotency_key').notNull(),
    sentAt: tz('sent_at').notNull(),
  },
  (t) => [
    uniqueIndex('proactive_sent_idempotency_key').on(t.userId, t.idempotencyKey),
    index('proactive_sent_user_char_date_idx').on(t.userId, t.characterId, t.localDate),
    index('proactive_sent_user_date_idx').on(t.userId, t.localDate),
  ],
);

/**
 * 主动消息待回复状态（SIM-05 第 6 条：用户未回复时同角色不再发新的）。
 * 每个（userId, characterId）最多一行；用户回复后删除该行。
 */
export const proactivePendingReply = proactiveSchema.table(
  'proactive_pending_reply',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 触发该待回复状态的发送记录 ID。 */
    sentLogId: uuid('sent_log_id').notNull(),
    /** 节日纪念日祝福不受「未回复不再发」限制，标记 true 时调度方忽略此行。 */
    isHoliday: boolean('is_holiday').notNull().default(false),
    createdAt: tz('created_at').notNull(),
  },
  (t) => [uniqueIndex('proactive_pending_reply_user_char').on(t.userId, t.characterId)],
);
