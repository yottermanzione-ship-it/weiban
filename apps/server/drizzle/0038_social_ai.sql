-- 0038_social_ai.sql
-- T-066 L4 AI：跨角色共享设置（MEM-07）、进入私聊记录（P-18）、角色共同事件（SOC-02）、
-- 朋友圈发帖账本（P-16）、名片推荐人（CHR-04 第 3 条）。
CREATE TABLE "ai_runtime"."memory_sharing_settings" (
  "user_id"    uuid        PRIMARY KEY NOT NULL,
  "level"      text        NOT NULL DEFAULT 'friends',
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "memory_sharing_level" CHECK ("level" IN ('off','basic','friends'))
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."chat_visits" (
  "user_id"         uuid        NOT NULL,
  "conversation_id" uuid        NOT NULL,
  "last_entered_at" timestamptz NOT NULL,
  "prev_entered_at" timestamptz,
  CONSTRAINT "chat_visit_pk" UNIQUE ("user_id", "conversation_id")
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."joint_events" (
  "id"             uuid        PRIMARY KEY NOT NULL,
  "user_id"        uuid        NOT NULL,
  "event_date"     text        NOT NULL,
  "character_a_id" uuid        NOT NULL,
  "character_b_id" uuid        NOT NULL,
  "kind"           text        NOT NULL,
  "summary"        text        NOT NULL,
  "detail"         text,
  "created_at"     timestamptz NOT NULL,
  CONSTRAINT "joint_event_pair_day_idx" UNIQUE ("user_id", "event_date", "character_a_id", "character_b_id"),
  CONSTRAINT "joint_event_kind" CHECK ("kind" IN ('work','social','leisure','errand','rest','unexpected'))
);
--> statement-breakpoint
CREATE INDEX "joint_event_a_idx" ON "ai_runtime"."joint_events" ("user_id", "character_a_id", "event_date");
--> statement-breakpoint
CREATE INDEX "joint_event_b_idx" ON "ai_runtime"."joint_events" ("user_id", "character_b_id", "event_date");
--> statement-breakpoint
CREATE TABLE "ai_runtime"."moments_plans" (
  "id"           uuid        PRIMARY KEY NOT NULL,
  "user_id"      uuid        NOT NULL,
  "character_id" uuid        NOT NULL,
  "local_date"   text        NOT NULL,
  "source_kind"  text        NOT NULL,
  "source_id"    text        NOT NULL,
  "status"       text        NOT NULL,
  "post_id"      uuid,
  "created_at"   timestamptz NOT NULL,
  CONSTRAINT "moments_plan_day_idx" UNIQUE ("user_id", "character_id", "local_date"),
  CONSTRAINT "moments_plan_source" CHECK ("source_kind" IN ('daily_event','public_update','holiday','pet')),
  CONSTRAINT "moments_plan_status" CHECK ("status" IN ('generating','posted','dropped'))
);
--> statement-breakpoint
CREATE INDEX "moments_plan_week_idx" ON "ai_runtime"."moments_plans" ("user_id", "character_id", "created_at");
--> statement-breakpoint
CREATE TABLE "ai_runtime"."card_referrals" (
  "user_id"                uuid        NOT NULL,
  "character_id"           uuid        NOT NULL,
  "referrer_character_id"  uuid        NOT NULL,
  "consumed"               boolean     NOT NULL DEFAULT false,
  "created_at"             timestamptz NOT NULL,
  CONSTRAINT "card_referral_pk" UNIQUE ("user_id", "character_id")
);
