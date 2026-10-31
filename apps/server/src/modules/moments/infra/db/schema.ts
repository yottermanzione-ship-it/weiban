/** moments 模块的表（迁移 0034）。所有行按 owner_user_id 隔离：每个用户有自己的朋友圈世界。 */
import {
  boolean,
  customType,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
const bytes = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const time = (name: string) => timestamp(name, { withTimezone: true });
export const momentsSchema = pgSchema('moments');

export interface StoredLink {
  url: string;
  title: string;
  source: string | null;
  description: string | null;
  coverMediaId: string | null;
  appHint: 'music' | 'video' | 'web';
}

export const posts = momentsSchema.table('posts', {
  id: uuid('id').primaryKey(),
  ownerUserId: uuid('owner_user_id').notNull(),
  authorKind: text('author_kind').notNull(),
  authorCharacterId: uuid('author_character_id'),
  textCiphertext: bytes('text_ciphertext').notNull(),
  link: jsonb('link').$type<StoredLink>(),
  /** 用户动态：all_characters / selected；角色动态为 null。 */
  visibilityKind: text('visibility_kind'),
  sourceKind: text('source_kind'),
  sourceId: text('source_id'),
  /**
   * 原文转发的公开内容标记（迁移 0151）：仅 postForEcology 与微博同步投递
   * 两条原文转发路径写入 true；maybePost 生成的私人动态一律 false。
   * 读脑分流与写回 recheck 只认此标记，不认 sourceKind。
   */
  forwardedPublic: boolean('forwarded_public').notNull().default(false),
  createKey: text('create_key').notNull(),
  createdAt: time('created_at').notNull(),
});

export const postMedia = momentsSchema.table(
  'post_media',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull(),
    width: integer('width'),
    height: integer('height'),
  },
  (t) => [primaryKey({ columns: [t.postId, t.position] })],
);

/** 用户动态「部分可见」时可见的角色（SOC-09 第 2 条）。 */
export const visibility = momentsSchema.table(
  'visibility',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.characterId] })],
);

export const likes = momentsSchema.table(
  'likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    actorKind: text('actor_kind').notNull(),
    actorRefId: uuid('actor_ref_id').notNull(),
    createdAt: time('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.actorKind, t.actorRefId] })],
);

export const comments = momentsSchema.table('comments', {
  id: uuid('id').primaryKey(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  authorKind: text('author_kind').notNull(),
  authorRefId: uuid('author_ref_id').notNull(),
  replyToCommentId: uuid('reply_to_comment_id'),
  replyToKind: text('reply_to_kind'),
  replyToRefId: uuid('reply_to_ref_id'),
  textCiphertext: bytes('text_ciphertext').notNull(),
  mentionsUser: boolean('mentions_user').notNull().default(false),
  createKey: text('create_key').notNull(),
  createdAt: time('created_at').notNull(),
});

/** 红点游标（SOC-07 第 7 条）。 */
export const badgeState = momentsSchema.table('badge_state', {
  userId: uuid('user_id').primaryKey(),
  postsSeenAt: time('posts_seen_at').notNull(),
  interactionsSeenAt: time('interactions_seen_at').notNull(),
});
