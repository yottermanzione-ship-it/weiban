/**
 * library 模块的表（T-078，迁移 0053）：收藏快照、分享图偏好、分享图生成次数。
 */
import {
  customType,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });
export const librarySchema = pgSchema('library');

/** 收藏：复制一份内容快照（正文加密），原消息 / 动态被删除后仍在（CHAT-11 第 3 条）。 */
export const favorites = librarySchema.table(
  'favorites',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').notNull(),
    /** message | moments_post */
    sourceKind: text('source_kind').notNull(),
    /** messageId 或 postId。 */
    sourceId: uuid('source_id').notNull(),
    conversationId: uuid('conversation_id'),
    /** 消息：user | character | system；动态：user | character。 */
    senderKind: text('sender_kind'),
    senderRefId: uuid('sender_ref_id'),
    /** 角色筛选用。 */
    characterId: uuid('character_id'),
    /** JSON 序列化的 ReceivedMessageContent，按用户数据密钥加密（AAD = library:favorite:{id}）。 */
    contentCiphertext: bytes('content_ciphertext').notNull(),
    contentType: text('content_type').notNull(),
    extraImages: uuid('extra_images').array().notNull(),
    /** 收藏时消息的内容范围（adult 不能进分享图）。 */
    scope: text('scope').notNull(),
    /** 收藏时消息的服务器标签（health 不能进分享图）。 */
    labels: text('labels').array().notNull(),
    sourceCreatedAt: time('source_created_at').notNull(),
    /** 0070（契约 3.1）：收藏时的角色名字 / 头像快照（头像是 library 复制的一份媒体对象）与原消息 seq。 */
    characterNameSnapshot: text('character_name_snapshot'),
    characterAvatarMediaIdSnapshot: uuid('character_avatar_media_id_snapshot'),
    sourceSeq: integer('source_seq'),
    createdAt: time('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('favorites_source_idx').on(t.userId, t.sourceKind, t.sourceId),
    index('favorites_user_time_idx').on(t.userId, t.createdAt, t.id),
    index('favorites_user_character_idx').on(t.userId, t.characterId),
  ],
);

export const sharePreferences = librarySchema.table('share_preferences', {
  userId: uuid('user_id').primaryKey(),
  defaultTemplate: text('default_template').notNull(),
  updatedAt: time('updated_at').notNull(),
});

/** 只记次数，不存图片（ShareEndpoints.recordGenerated）。 */
export const shareGenerations = librarySchema.table(
  'share_generations',
  {
    userId: uuid('user_id').notNull(),
    template: text('template').notNull(),
    count: integer('count').notNull(),
    updatedAt: time('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.template] })],
);
