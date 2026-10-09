-- 0034_moments.sql
-- T-064 朋友圈模块（SOC-07～SOC-09）。每个用户有自己的朋友圈世界：所有行都按 owner_user_id 隔离。
-- 文字（动态、评论）用信封加密存储，与聊天消息一致。
-- statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "moments";
-- statement-breakpoint
CREATE TABLE "moments"."posts" (
  "id"                   uuid        PRIMARY KEY,
  "owner_user_id"        uuid        NOT NULL,
  "author_kind"          text        NOT NULL,
  "author_character_id"  uuid,
  "text_ciphertext"      bytea       NOT NULL,
  "link"                 jsonb,
  "visibility_kind"      text,
  "source_kind"          text,
  "source_id"            text,
  "create_key"           text        NOT NULL,
  "created_at"           timestamptz NOT NULL,
  CONSTRAINT "posts_author_check" CHECK (
    ("author_kind" = 'user' AND "author_character_id" IS NULL AND "visibility_kind" IN ('all_characters','selected'))
    OR ("author_kind" = 'character' AND "author_character_id" IS NOT NULL AND "visibility_kind" IS NULL)
  )
);
-- statement-breakpoint
CREATE UNIQUE INDEX "posts_create_key_idx" ON "moments"."posts" ("owner_user_id", "create_key");
-- statement-breakpoint
CREATE INDEX "posts_feed_idx" ON "moments"."posts" ("owner_user_id", "created_at" DESC, "id" DESC);
-- statement-breakpoint
CREATE INDEX "posts_author_idx" ON "moments"."posts" ("owner_user_id", "author_character_id", "created_at" DESC);
-- statement-breakpoint
CREATE TABLE "moments"."post_media" (
  "post_id"   uuid    NOT NULL REFERENCES "moments"."posts"("id") ON DELETE CASCADE,
  "position"  integer NOT NULL,
  "media_id"  uuid    NOT NULL,
  "width"     integer,
  "height"    integer,
  PRIMARY KEY ("post_id", "position"),
  CONSTRAINT "post_media_position_check" CHECK ("position" BETWEEN 0 AND 8)
);
-- statement-breakpoint
CREATE TABLE "moments"."visibility" (
  "post_id"       uuid NOT NULL REFERENCES "moments"."posts"("id") ON DELETE CASCADE,
  "character_id"  uuid NOT NULL,
  PRIMARY KEY ("post_id", "character_id")
);
-- statement-breakpoint
CREATE TABLE "moments"."likes" (
  "post_id"       uuid        NOT NULL REFERENCES "moments"."posts"("id") ON DELETE CASCADE,
  "actor_kind"    text        NOT NULL,
  "actor_ref_id"  uuid        NOT NULL,
  "created_at"    timestamptz NOT NULL,
  PRIMARY KEY ("post_id", "actor_kind", "actor_ref_id"),
  CONSTRAINT "likes_actor_check" CHECK ("actor_kind" IN ('user','character'))
);
-- statement-breakpoint
CREATE TABLE "moments"."comments" (
  "id"                   uuid        PRIMARY KEY,
  "post_id"              uuid        NOT NULL REFERENCES "moments"."posts"("id") ON DELETE CASCADE,
  "author_kind"          text        NOT NULL,
  "author_ref_id"        uuid        NOT NULL,
  "reply_to_comment_id"  uuid,
  "reply_to_kind"        text,
  "reply_to_ref_id"      uuid,
  "text_ciphertext"      bytea       NOT NULL,
  "mentions_user"        boolean     NOT NULL DEFAULT false,
  "create_key"           text        NOT NULL,
  "created_at"           timestamptz NOT NULL,
  CONSTRAINT "comments_author_check" CHECK ("author_kind" IN ('user','character')),
  CONSTRAINT "comments_reply_check" CHECK (("reply_to_comment_id" IS NULL) = ("reply_to_kind" IS NULL))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "comments_create_key_idx" ON "moments"."comments" ("post_id", "author_kind", "author_ref_id", "create_key");
-- statement-breakpoint
CREATE INDEX "comments_post_idx" ON "moments"."comments" ("post_id", "created_at");
-- statement-breakpoint
CREATE TABLE "moments"."badge_state" (
  "user_id"               uuid        PRIMARY KEY,
  "posts_seen_at"         timestamptz NOT NULL,
  "interactions_seen_at"  timestamptz NOT NULL
);
