-- 0053_library.sql
-- T-078 library：收藏（内容快照，CHAT-11）、分享图偏好与生成次数（EXP-01、EXP-02）。
-- 快照正文按用户数据密钥加密（同 chat.messages），原消息被删除后收藏仍在。
CREATE SCHEMA IF NOT EXISTS "library";
-- statement-breakpoint
CREATE TABLE "library"."favorites" (
  "id"                uuid        PRIMARY KEY,
  "user_id"           uuid        NOT NULL,
  "source_kind"       text        NOT NULL,
  "source_id"         uuid        NOT NULL,
  "conversation_id"   uuid,
  "sender_kind"       text,
  "sender_ref_id"     uuid,
  "character_id"      uuid,
  "content_ciphertext" bytea      NOT NULL,
  "content_type"      text        NOT NULL,
  "extra_images"      uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  "scope"             text        NOT NULL DEFAULT 'normal',
  "labels"            text[]      NOT NULL DEFAULT '{}'::text[],
  "source_created_at" timestamptz NOT NULL,
  "created_at"        timestamptz NOT NULL,
  CONSTRAINT "favorite_source_kind" CHECK ("source_kind" IN ('message','moments_post')),
  CONSTRAINT "favorite_scope" CHECK ("scope" IN ('normal','adult'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "favorites_source_idx" ON "library"."favorites" ("user_id","source_kind","source_id");
-- statement-breakpoint
CREATE INDEX "favorites_user_time_idx" ON "library"."favorites" ("user_id","created_at" DESC,"id" DESC);
-- statement-breakpoint
CREATE INDEX "favorites_user_character_idx" ON "library"."favorites" ("user_id","character_id");
-- statement-breakpoint
CREATE TABLE "library"."share_preferences" (
  "user_id"          uuid        PRIMARY KEY,
  "default_template" text        NOT NULL DEFAULT 'pink_filter',
  "updated_at"       timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE "library"."share_generations" (
  "user_id"    uuid        NOT NULL,
  "template"   text        NOT NULL,
  "count"      integer     NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id","template")
);
