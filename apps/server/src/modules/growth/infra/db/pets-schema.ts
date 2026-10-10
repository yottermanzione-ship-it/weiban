/**
 * growth 第三部分：共同领养宠物（T-077，迁移 0052，PLAY-02、ADM-04 第 5 条）。schema 仍是 `growth`。
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
/** 与 schema.ts 同一个 PostgreSQL schema（单独声明，避免两个文件循环引用）。 */
const growthSchema = pgSchema('growth');

/** 宠物图鉴：物种（管理员维护）。下架后不能新领养，已领养的不受影响。 */
export const petSpecies = growthSchema.table('pet_species', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  intro: text('intro').notNull().default(''),
  presetNames: text('preset_names')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  listed: boolean('listed').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** 物种外观：三个成长阶段的插画（media 素材，purpose = pet_art）。外观不删除，只能改图。 */
export const petAppearances = growthSchema.table(
  'pet_appearances',
  {
    id: uuid('id').primaryKey(),
    speciesId: uuid('species_id').notNull(),
    name: text('name').notNull(),
    babyMediaId: uuid('baby_media_id').notNull(),
    juniorMediaId: uuid('junior_media_id').notNull(),
    adultMediaId: uuid('adult_media_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pet_appearances_species_idx').on(t.speciesId)],
);

/**
 * 宠物。stage 由每小时扫描和读取时按领养天数推进（只升不降）；intimacy 只升不降。
 * 每个角色同时最多 1 只在养（部分唯一索引），总数 3 只在 service 中加锁校验（P-38）。
 */
export const pets = growthSchema.table(
  'pets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    speciesId: uuid('species_id').notNull(),
    appearanceId: uuid('appearance_id').notNull(),
    name: text('name').notNull(),
    stage: text('stage').notNull().default('baby'),
    adoptedOn: date('adopted_on', { mode: 'string' }).notNull(),
    intimacy: integer('intimacy').notNull().default(0),
    allowMomentsShare: boolean('allow_moments_share').notNull().default(true),
    status: text('status').notNull().default('active'),
    sentAwayAt: timestamp('sent_away_at', { withTimezone: true }),
    namedByCharacter: boolean('named_by_character').notNull().default(false),
    clientRequestId: uuid('client_request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('pets_user_request_uq').on(t.userId, t.clientRequestId),
    uniqueIndex('pets_one_active_per_character_uq')
      .on(t.userId, t.characterId)
      .where(sql`${t.status} = 'active'`),
    index('pets_user_idx').on(t.userId),
    index('pets_status_idx').on(t.status),
  ],
);

/** 按钮互动记录（不调用模型、不花钱）；counted = 是否计入当天亲密值（每天前 5 次）。 */
export const petInteractions = growthSchema.table(
  'pet_interactions',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id').notNull(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    counted: boolean('counted').notNull(),
    clientActionId: uuid('client_action_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('pet_interactions_action_uq').on(t.petId, t.clientActionId),
    index('pet_interactions_pet_date_idx').on(t.petId, t.localDate),
  ],
);

/** 成长记录（领养、阶段变化、改名、送养）。detail 记下当时的名字，改名后旧记录不变。 */
export const petTimeline = growthSchema.table(
  'pet_timeline',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id').notNull(),
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, string>>().notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pet_timeline_pet_idx').on(t.petId, t.at)],
);

/** 宠物相册：角色发来的照片（来自私聊消息）+ 用户上传的。 */
export const petAlbum = growthSchema.table(
  'pet_album',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id').notNull(),
    userId: uuid('user_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    source: text('source').notNull(),
    messageId: uuid('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('pet_album_media_uq').on(t.petId, t.mediaId),
    index('pet_album_pet_idx').on(t.petId, t.createdAt),
  ],
);

/** 「让 TA 起名」请求：ai-runtime 经 PetNamingPort 回传 3 个候选名。 */
export const petNamingRequests = growthSchema.table(
  'pet_naming_requests',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    characterId: uuid('character_id').notNull(),
    speciesId: uuid('species_id').notNull(),
    appearanceId: uuid('appearance_id').notNull(),
    status: text('status').notNull().default('pending'),
    names: text('names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** 用户在私聊卡片里选中的候选（排在 names 第一位返回）。 */
    chosenIndex: integer('chosen_index'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('pet_naming_requests_user_idx').on(t.userId, t.characterId)],
);
