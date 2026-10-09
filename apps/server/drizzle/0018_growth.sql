-- 0018_growth.sql
-- T-050：L3 growth 模块第一部分 — 熟悉度、认识天数与纪念日。
--
-- 新增 schema：growth
-- 1. growth.familiarity — 每个用户对每个角色的累计熟悉度点数、当前等级、今日已得点数与重置日期。
-- 2. growth.familiarity_events — 每次加分记录（幂等：同一 idempotency_key 只记一条）。
-- 3. growth.anniversaries — 用户自定义纪念日（每角色最多 10 条，GRW-04 第 4 条）。
--
-- idx 18，when > 1791700000000
-- statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "growth";
-- statement-breakpoint
CREATE TABLE "growth"."familiarity" (
  "id"                   uuid        PRIMARY KEY,
  "user_id"              uuid        NOT NULL,
  "character_id"         uuid        NOT NULL,
  "total_points"         integer     NOT NULL DEFAULT 0,
  "level"                integer     NOT NULL DEFAULT 1,
  "daily_points"         integer     NOT NULL DEFAULT 0,
  "daily_points_date"    date        NOT NULL,
  "updated_at"           timestamptz NOT NULL,
  CONSTRAINT "familiarity_level_check"  CHECK ("level" BETWEEN 1 AND 5),
  CONSTRAINT "familiarity_points_check" CHECK ("total_points" >= 0),
  CONSTRAINT "familiarity_daily_check"  CHECK ("daily_points" >= 0)
);
-- statement-breakpoint
CREATE UNIQUE INDEX "familiarity_user_char_idx"
  ON "growth"."familiarity" ("user_id", "character_id");
-- statement-breakpoint
CREATE TABLE "growth"."familiarity_events" (
  "id"                uuid        PRIMARY KEY,
  "user_id"           uuid        NOT NULL,
  "character_id"      uuid        NOT NULL,
  "event_type"        text        NOT NULL,
  "points"            integer     NOT NULL,
  "idempotency_key"   text        NOT NULL,
  "occurred_at"       timestamptz NOT NULL,
  CONSTRAINT "familiarity_events_points_check" CHECK ("points" > 0)
);
-- statement-breakpoint
CREATE UNIQUE INDEX "familiarity_events_idem_idx"
  ON "growth"."familiarity_events" ("idempotency_key");
-- statement-breakpoint
CREATE INDEX "familiarity_events_user_char_idx"
  ON "growth"."familiarity_events" ("user_id", "character_id");
-- statement-breakpoint
CREATE TABLE "growth"."anniversaries" (
  "id"            uuid        PRIMARY KEY,
  "user_id"       uuid        NOT NULL,
  "character_id"  uuid        NOT NULL,
  "label"         text        NOT NULL,
  "date"          date        NOT NULL,
  "created_at"    timestamptz NOT NULL,
  CONSTRAINT "anniversary_label_length" CHECK (char_length("label") BETWEEN 1 AND 30)
);
-- statement-breakpoint
CREATE INDEX "anniversaries_user_char_idx"
  ON "growth"."anniversaries" ("user_id", "character_id");
