import {
  pgSchema,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  customType,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
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
  inStore: boolean('in_store').notNull().default(false),
  storeOrder: integer('store_order').notNull().default(0),
  intro: text('intro').notNull().default(''),
  coverStickerId: uuid('cover_sticker_id'),
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

/** 0154：离线打标签的完整意思（sticker-tag-v1），一 sticker 一行；不改 library_stickers.description。 */
export const libraryStickerLabels = mediaSchema.table(
  'library_sticker_labels',
  {
    stickerId: uuid('sticker_id')
      .primaryKey()
      .references(() => libraryStickers.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull(),
    contentHash: text('content_hash').notNull(),
    fullDescription: text('full_description').notNull(),
    imageText: text('image_text').notNull(),
    literalMeaning: text('literal_meaning').notNull(),
    usageMeaning: text('usage_meaning').notNull(),
    suitableContexts: text('suitable_contexts').notNull(),
    unsuitableContexts: text('unsuitable_contexts').notNull(),
    primaryTag: text('primary_tag').notNull(),
    /** 情绪与强度（主情绪/强度/副情绪，个别行含额外键，原样保存）。 */
    emotion: jsonb('emotion').$type<Record<string, unknown>>().notNull(),
    confidence: numeric('confidence').notNull(),
    reviewNeeded: boolean('review_needed').notNull().default(false),
    /** 排除标记：低可信度行与空白占位图为 true，选图整行排除（见 listStickersForCharacter）。 */
    retryExcluded: boolean('retry_excluded').notNull().default(false),
    model: text('model').notNull(),
    tagVersion: text('tag_version').notNull(),
    taggedAt: timestamp('tagged_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('library_sticker_labels_media_idx').on(t.mediaId)],
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
  /** 0071（契约 3.1）：古风插画。 */
  classicalStyle: boolean('classical_style').notNull().default(false),
  enabled: boolean('enabled').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** 0100：用户从商店添加的包，内置包不需复制关系。 */
export const userStickerPacks = mediaSchema.table(
  'user_sticker_packs',
  {
    userId: uuid('user_id').notNull(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => stickerPacks.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.packId] })],
);
