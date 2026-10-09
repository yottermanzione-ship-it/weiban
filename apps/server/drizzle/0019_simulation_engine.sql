-- 0019_simulation_engine.sql
-- T-051 L3 推演引擎：每角色每日事件、心情状态、推演控制。
--
-- 新增三张表（schema ai_runtime）：
--   simulation_states  - 每个（用户 × 角色）的推演控制状态：上次运行时间、暂停原因、今日已用事件数。
--   daily_events       - 生成的日常事件流水，供主动消息 / 时间线消费。
--   mood_states        - 每个（用户 × 角色）当前心情，随推演更新。
--
-- 规模控制（SIM-12）：
--   每角色每日最多生成 MAX_EVENTS_PER_CHARACTER_PER_DAY = 8 条事件（application 层强制）。
--   推演每天至多调用 1 次模型，用途 simulation，countAsBackground=true。
--
-- 长期不活跃暂停（SIM-13）：
--   last_active_at 超过 14 天时推演暂停（application 层判断），不删已有事件。
-- statement-breakpoint
CREATE TABLE "ai_runtime"."simulation_states" (
  "id"                  uuid        PRIMARY KEY NOT NULL,
  "user_id"             uuid        NOT NULL,
  "character_id"        uuid        NOT NULL,
  "last_simulated_date" date,
  "last_active_at"      timestamptz NOT NULL,
  "events_today"        integer     NOT NULL DEFAULT 0,
  "paused_reason"       text,
  "updated_at"          timestamptz NOT NULL,
  CONSTRAINT "simulation_state_owner_idx" UNIQUE ("user_id", "character_id"),
  CONSTRAINT "simulation_events_today_check" CHECK ("events_today" >= 0),
  CONSTRAINT "simulation_paused_reason_check"
    CHECK ("paused_reason" IS NULL OR "paused_reason" IN ('budget_exceeded', 'inactive', 'model_unavailable'))
);
-- statement-breakpoint
CREATE TABLE "ai_runtime"."daily_events" (
  "id"           uuid        PRIMARY KEY NOT NULL,
  "user_id"      uuid        NOT NULL,
  "character_id" uuid        NOT NULL,
  "event_date"   date        NOT NULL,
  "seq"          integer     NOT NULL,
  "kind"         text        NOT NULL,
  "summary"      text        NOT NULL,
  "detail"       text,
  "mood_after"   text,
  "created_at"   timestamptz NOT NULL,
  CONSTRAINT "daily_event_date_owner_seq_idx" UNIQUE ("user_id", "character_id", "event_date", "seq"),
  CONSTRAINT "daily_event_seq_check" CHECK ("seq" >= 0),
  CONSTRAINT "daily_event_kind_check"
    CHECK ("kind" IN ('work', 'social', 'leisure', 'errand', 'rest', 'unexpected')),
  CONSTRAINT "daily_event_mood_check"
    CHECK ("mood_after" IS NULL OR "mood_after" IN ('happy', 'neutral', 'tired', 'annoyed', 'excited', 'sad', 'anxious'))
);
-- statement-breakpoint
CREATE INDEX "daily_event_owner_date_idx"
  ON "ai_runtime"."daily_events" ("user_id", "character_id", "event_date");
-- statement-breakpoint
CREATE TABLE "ai_runtime"."mood_states" (
  "id"           uuid        PRIMARY KEY NOT NULL,
  "user_id"      uuid        NOT NULL,
  "character_id" uuid        NOT NULL,
  "mood"         text        NOT NULL DEFAULT 'neutral',
  "updated_at"   timestamptz NOT NULL,
  CONSTRAINT "mood_state_owner_idx" UNIQUE ("user_id", "character_id"),
  CONSTRAINT "mood_state_mood_check"
    CHECK ("mood" IN ('happy', 'neutral', 'tired', 'annoyed', 'excited', 'sad', 'anxious'))
);
