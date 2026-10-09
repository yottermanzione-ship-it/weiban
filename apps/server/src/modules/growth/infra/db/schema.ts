import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const growthSchema = pgSchema('growth');

/**
 * 每个用户对每个角色的熟悉度状态（GRW-03, P-25）。
 * 单日加分上限在 service 层用 daily_points + daily_points_date 维护，不依赖事件表查询。
 */
export const familiarity = growthSchema.table(
  'familiarity',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 累计总点数（只升不降，GRW-03 第 3 条）。 */
    totalPoints: integer('total_points').notNull().default(0),
    /** 当前等级 1–5。 */
    level: integer('level').notNull().default(1),
    /** 今日已得点数；配合 dailyPointsDate 做每日上限检查。 */
    dailyPoints: integer('daily_points').notNull().default(0),
    /** 今日加分的「用户本地日期」（YYYY-MM-DD）；跨天时重置 dailyPoints。 */
    dailyPointsDate: date('daily_points_date', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('familiarity_user_char_idx').on(t.userId, t.characterId),
    check('familiarity_level_check', sql`${t.level} BETWEEN 1 AND 5`),
    check('familiarity_points_check', sql`${t.totalPoints} >= 0`),
    check('familiarity_daily_check', sql`${t.dailyPoints} >= 0`),
  ],
);

/**
 * 每次加分事件的流水记录；idempotency_key 唯一索引确保同一业务事件只计一次（GRW-03 第 2 条）。
 */
export const familiarityEvents = growthSchema.table(
  'familiarity_events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    eventType: text('event_type').notNull(),
    points: integer('points').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('familiarity_events_idem_idx').on(t.idempotencyKey),
    index('familiarity_events_user_char_idx').on(t.userId, t.characterId),
    check('familiarity_events_points_check', sql`${t.points} > 0`),
  ],
);

/**
 * 用户自定义纪念日（每角色最多 10 条，GRW-04 第 4 条）。
 * 系统预置纪念日节点在 service 层按 knownSince 动态计算，不存库。
 */
export const anniversaries = growthSchema.table(
  'anniversaries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** 纪念日名称，最多 30 字。 */
    label: text('label').notNull(),
    /** 用户本地日期，YYYY-MM-DD。 */
    date: date('date', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('anniversaries_user_char_idx').on(t.userId, t.characterId),
    check('anniversary_label_length', sql`char_length(${t.label}) BETWEEN 1 AND 30`),
  ],
);
