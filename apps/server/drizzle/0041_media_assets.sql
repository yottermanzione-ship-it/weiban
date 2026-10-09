-- 0041_media_assets.sql
-- T-069 素材库（ADM-04 第 1～3 条）：表情包分类与表情、用户自定义表情、音色库、卡面模板。
-- statement-breakpoint
CREATE TABLE "media"."sticker_packs" (
  "id"            uuid        PRIMARY KEY,
  "name"          text        NOT NULL,
  "character_ids" jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "user_visible"  boolean     NOT NULL,
  "enabled"       boolean     NOT NULL,
  "created_at"    timestamptz NOT NULL,
  "updated_at"    timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE "media"."library_stickers" (
  "id"           uuid        PRIMARY KEY,
  "pack_id"      uuid        NOT NULL REFERENCES "media"."sticker_packs"("id") ON DELETE CASCADE,
  "media_id"     uuid        NOT NULL,
  "description"  text        NOT NULL,
  "sort_order"   integer     NOT NULL,
  "confirmed_by" uuid        NOT NULL,
  "created_at"   timestamptz NOT NULL,
  "deleted_at"   timestamptz
);
-- statement-breakpoint
CREATE INDEX "library_stickers_pack_idx" ON "media"."library_stickers" ("pack_id");
-- statement-breakpoint
CREATE TABLE "media"."user_stickers" (
  "id"           uuid        PRIMARY KEY,
  "user_id"      uuid        NOT NULL,
  "media_id"     uuid        NOT NULL,
  "content_hash" text,
  "sort_order"   integer     NOT NULL,
  "created_at"   timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "user_stickers_user_idx" ON "media"."user_stickers" ("user_id");
-- statement-breakpoint
CREATE UNIQUE INDEX "user_stickers_user_hash_uq" ON "media"."user_stickers" ("user_id", "content_hash");
-- statement-breakpoint
CREATE TABLE "media"."voices" (
  "id"                     uuid        PRIMARY KEY,
  "name"                   text        NOT NULL,
  "tags"                   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "sample_media_id"        uuid,
  "provider_voice_key"     text        NOT NULL,
  "model_key"              text        NOT NULL,
  "care_fallback_media_id" uuid,
  "enabled"                boolean     NOT NULL,
  "created_at"             timestamptz NOT NULL,
  "updated_at"             timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE "media"."card_templates" (
  "id"            uuid        PRIMARY KEY,
  "name"          text        NOT NULL,
  "kinds"         jsonb       NOT NULL,
  "media_id"      uuid        NOT NULL,
  "portrait_free" boolean     NOT NULL,
  "enabled"       boolean     NOT NULL,
  "created_at"    timestamptz NOT NULL,
  "updated_at"    timestamptz NOT NULL
);
