-- 0050_growth_cards_achievements.sql
-- T-076 卡片（GRW-05）与成就（GRW-06）。
-- statement-breakpoint
CREATE TABLE "growth"."cards" (
  "id"                 uuid        PRIMARY KEY,
  "user_id"            uuid        NOT NULL,
  "character_id"       uuid        NOT NULL,
  "kind"               text        NOT NULL,
  "serial_no"          integer     NOT NULL,
  "title"              text        NOT NULL,
  "line"               text        NOT NULL,
  "obtained_on"        date        NOT NULL,
  "template_id"        uuid,
  "media_id"           uuid,
  "source_message_ids" uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  "idempotency_key"    text        NOT NULL,
  "scene_week"         date,
  "created_at"         timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "cards_user_char_key_uq" ON "growth"."cards" ("user_id", "character_id", "idempotency_key");
-- statement-breakpoint
CREATE UNIQUE INDEX "cards_user_char_serial_uq" ON "growth"."cards" ("user_id", "character_id", "serial_no");
-- statement-breakpoint
CREATE UNIQUE INDEX "cards_scene_week_uq" ON "growth"."cards" ("user_id", "character_id", "scene_week") WHERE "scene_week" IS NOT NULL;
-- statement-breakpoint
CREATE INDEX "cards_user_char_idx" ON "growth"."cards" ("user_id", "character_id");
-- statement-breakpoint
CREATE TABLE "growth"."achievement_unlocks" (
  "user_id"         uuid        NOT NULL,
  "achievement_key" text        NOT NULL,
  "no"              integer     NOT NULL,
  "character_id"    uuid,
  "unlocked_at"     timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "achievement_key")
);
-- statement-breakpoint
CREATE TABLE "growth"."achievement_counters" (
  "user_id"     uuid        NOT NULL,
  "counter_key" text        NOT NULL,
  "value"       integer     NOT NULL DEFAULT 0,
  "updated_at"  timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "counter_key")
);
