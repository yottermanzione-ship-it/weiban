import {
  pgSchema,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  customType,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
export const mediaSchema = pgSchema('media');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const objects = mediaSchema.table(
  'objects',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id'),
    purpose: text('purpose').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** 音频为 null（0040 起可空）。 */
    width: integer('width'),
    height: integer('height'),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** 0040：缩略图（短边 360px，WebP），与原图同一加密方式。 */
    thumbStorageKey: text('thumb_storage_key').unique(),
    /** 0040：语音时长。 */
    durationMs: integer('duration_ms'),
    /** 0040：语音转文字状态（pending / ready / failed / unavailable），只有 chat_voice 有值。 */
    transcriptStatus: text('transcript_status'),
    /** 0040：转写文字（信封加密，与文件同一所有者）。 */
    transcriptCiphertext: bytea('transcript_ciphertext'),
    /** 0040：明文内容 SHA-256（「添加到表情」判断是否已添加过）。 */
    contentHash: text('content_hash'),
    /** 0040：生命周期——到期后由清理任务物理删除；null 表示长期保留。 */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('objects_owner_idx').on(t.ownerId), index('objects_expires_idx').on(t.expiresAt)],
);

/** 0041：表情包分类（ADM-04 第 1 条）。characterIds 为空 = 所有角色可用。 */
export const stickerPacks = mediaSchema.table('sticker_packs', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  characterIds: jsonb('character_ids').$type<string[]>().notNull(),
  userVisible: boolean('user_visible').notNull(),
  enabled: boolean('enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** 0041：表情包库中的表情。删除为软删除（已发出的消息仍能显示，媒体对象不删）。 */
export const libraryStickers = mediaSchema.table(
  'library_stickers',
  {
    id: uuid('id').primaryKey(),
    packId: uuid('pack_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull(),
    confirmedBy: uuid('confirmed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('library_stickers_pack_idx').on(t.packId)],
);

/** 0041：用户自己添加的表情（MED-01 第 3 条）。media 对象为 user_sticker，属于用户本人。 */
export const userStickers = mediaSchema.table(
  'user_stickers',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    mediaId: uuid('media_id').notNull(),
    contentHash: text('content_hash'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [
    index('user_stickers_user_idx').on(t.userId),
    uniqueIndex('user_stickers_user_hash_uq').on(t.userId, t.contentHash),
  ],
);

/** 0041：音色库（ADM-04 第 2 条）。 */
export const voices = mediaSchema.table('voices', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  sampleMediaId: uuid('sample_media_id'),
  providerVoiceKey: text('provider_voice_key').notNull(),
  modelKey: text('model_key').notNull(),
  careFallbackMediaId: uuid('care_fallback_media_id'),
  enabled: boolean('enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** 0041：卡面模板库（ADM-04 第 3 条）。 */
export const cardTemplates = mediaSchema.table('card_templates', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  kinds: jsonb('kinds').$type<string[]>().notNull(),
  mediaId: uuid('media_id').notNull(),
  portraitFree: boolean('portrait_free').notNull(),
  enabled: boolean('enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});
