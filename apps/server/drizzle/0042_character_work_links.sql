-- 0042_character_work_links.sql
-- T-069 作品链接库（MED-05）与预设角色默认音色（MED-03 第 1 条），数据归 characters（contracts-3.0-map.md T-069 一栏）。
-- statement-breakpoint
CREATE TABLE "characters"."work_links" (
  "id"             uuid        PRIMARY KEY,
  "character_id"   uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "title"          text        NOT NULL,
  "url"            text        NOT NULL,
  "source"         text,
  "app_hint"       text        NOT NULL,
  "cover_media_id" uuid,
  "check_ok"       boolean,
  "checked_at"     timestamptz,
  "enabled"        boolean     NOT NULL,
  "created_at"     timestamptz NOT NULL,
  "updated_at"     timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "work_links_character_idx" ON "characters"."work_links" ("character_id");
-- statement-breakpoint
CREATE TABLE "characters"."default_voices" (
  "character_id" uuid        PRIMARY KEY REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "voice_id"     uuid        NOT NULL,
  "updated_at"   timestamptz NOT NULL
);
