import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  boolean,
  primaryKey,
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
    /** 当前阶段 1–6（3.25 起六阶段，迁移 0122）。存的是已卡上限后的阶段，只升不降（未成年重分类除外）。 */
    level: integer('level').notNull().default(1),
    /** 今日已得点数；配合 dailyPointsDate 做每日上限检查。 */
    dailyPoints: integer('daily_points').notNull().default(0),
    /** 今日加分的「用户本地日期」（YYYY-MM-DD）；跨天时重置 dailyPoints。 */
    dailyPointsDate: date('daily_points_date', { mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /**
     * 按消息加分（16 号 §11）：该用户发给该角色的上一条消息内容指纹（去空白后的 SHA-256，不存正文），
     * 用于「与上一条完全相同不计分」。
     */
    lastMessageHash: text('last_message_hash'),
    /** 上一条计分消息的发送时刻，用于「距上一条计分消息至少 3 秒」。 */
    lastMessageScoredAt: timestamp('last_message_scored_at', { withTimezone: true }),
    /** 3.25（迁移 0122）：用户明确要求暂停恋爱 / 暧昧表达（旧版 romance_paused）。 */
    romancePaused: boolean('romance_paused').notNull().default(false),
    /** 3.25：用户希望被怎么称呼（「叫我老婆」→ 老婆；旧版 preferred_partner_title）。 */
    preferredTitle: text('preferred_title'),
  },
  (t) => [
    uniqueIndex('familiarity_user_char_idx').on(t.userId, t.characterId),
    check('familiarity_level_check', sql`${t.level} BETWEEN 1 AND 6`),
    check('familiarity_points_check', sql`${t.totalPoints} >= 0`),
    check('familiarity_daily_check', sql`${t.dailyPoints} >= 0`),
  ],
);

/** 3.25（迁移 0122）：growth 的后台配置（键值）。familiarity_stages = { thresholds: number[6] }。 */
export const growthSettings = growthSchema.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  updatedBy: uuid('updated_by'),
});

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
    /** 3.0.2（T-076，迁移 0051）：每年提醒。 */
    repeatYearly: boolean('repeat_yearly').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('anniversaries_user_char_idx').on(t.userId, t.characterId),
    check('anniversary_label_length', sql`char_length(${t.label}) BETWEEN 1 AND 30`),
  ],
);

// ---------- T-076：卡片与成就（迁移 0050–0051） ----------

/**
 * 卡片（GRW-05）。每个用户每个角色一本卡册，serial_no 为该卡册内的编号（No.001 起）。
 * scene_week 只在「名场面」瞬间卡上有值（用户当地日期所在周的周一），部分唯一索引保证每角色每周最多 1 张。
 * 删除角色彻底删除（contacts.contact_purged）时随之删除；成就不随之收回。
 */
export const cards = growthSchema.table(
  'cards',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    /** anniversary | familiarity | holiday | moment | pet | play */
    kind: text('kind').notNull(),
    serialNo: integer('serial_no').notNull(),
    title: text('title').notNull(),
    line: text('line').notNull(),
    obtainedOn: date('obtained_on', { mode: 'string' }).notNull(),
    templateId: uuid('template_id'),
    mediaId: uuid('media_id'),
    sourceMessageIds: uuid('source_message_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    idempotencyKey: text('idempotency_key').notNull(),
    sceneWeek: date('scene_week', { mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('cards_user_char_key_uq').on(t.userId, t.characterId, t.idempotencyKey),
    uniqueIndex('cards_user_char_serial_uq').on(t.userId, t.characterId, t.serialNo),
    uniqueIndex('cards_scene_week_uq')
      .on(t.userId, t.characterId, t.sceneWeek)
      .where(sql`${t.sceneWeek} IS NOT NULL`),
    index('cards_user_char_idx').on(t.userId, t.characterId),
  ],
);

/** 已获得的成就（GRW-06）。永不收回：删除角色时不删，只在注销账号时删除。 */
export const achievementUnlocks = growthSchema.table(
  'achievement_unlocks',
  {
    userId: uuid('user_id').notNull(),
    achievementKey: text('achievement_key').notNull(),
    no: integer('no').notNull(),
    /** 触发时相关的角色（仅记录，不用于收回）。 */
    characterId: uuid('character_id'),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementKey] })],
);

/** 累计类成就的计数（只统计次数，不存内容，GRW-06 第 7 条）。 */
export const achievementCounters = growthSchema.table(
  'achievement_counters',
  {
    userId: uuid('user_id').notNull(),
    counterKey: text('counter_key').notNull(),
    value: integer('value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.counterKey] })],
);

/**
 * growth 自己的通讯录索引（纪念日每日扫描用；growth 不能读 contacts 的表）。
 * 由 contacts 事件维护；last_checked_on = 上次扫描时的用户当地日期。
 */
export const contactIndex = growthSchema.table(
  'contact_index',
  {
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    knownSince: date('known_since', { mode: 'string' }).notNull(),
    active: boolean('active').notNull().default(true),
    lastCheckedOn: date('last_checked_on', { mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.characterId] }),
    index('contact_index_active_idx').on(t.active),
  ],
);

/** 一次性通知去重（自定义纪念日到达等），notice_key 自带日期。 */
export const notices = growthSchema.table(
  'notices',
  {
    userId: uuid('user_id').notNull(),
    noticeKey: text('notice_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.noticeKey] })],
);

// T-077 宠物表（drizzle.config 只扫描 schema.ts，所以在这里转出）。
export * from './pets-schema.js';
