-- 0022_proactive_scheduler.sql
-- T-053 L3 主动消息调度：调度计划（含理由）与用户聊天活跃小时。
CREATE TABLE "ai_runtime"."proactive_plans" (
  "id"             uuid        PRIMARY KEY NOT NULL,
  "user_id"        uuid        NOT NULL,
  "character_id"   uuid        NOT NULL,
  "reason"         text        NOT NULL,
  "source_ref"     text        NOT NULL,
  "topic_key"      text        NOT NULL,
  "brief"          text        NOT NULL,
  "local_date"     text        NOT NULL,
  "is_holiday"     boolean     NOT NULL DEFAULT false,
  "priority"       integer     NOT NULL DEFAULT 0,
  "status"         text        NOT NULL,
  "due_at"         timestamptz NOT NULL,
  "deferred_since" timestamptz,
  "outcome"        text,
  "message_id"     uuid,
  "created_at"     timestamptz NOT NULL,
  "updated_at"     timestamptz NOT NULL,
  CONSTRAINT "proactive_plan_source_idx" UNIQUE ("user_id", "character_id", "source_ref"),
  CONSTRAINT "proactive_plan_status" CHECK ("status" IN ('planned','generating','sent','dropped'))
);
--> statement-breakpoint
CREATE INDEX "proactive_plan_due_idx" ON "ai_runtime"."proactive_plans" ("status", "due_at");
--> statement-breakpoint
CREATE INDEX "proactive_plan_topic_idx" ON "ai_runtime"."proactive_plans" ("user_id", "character_id", "topic_key");
--> statement-breakpoint
CREATE TABLE "ai_runtime"."user_chat_activity" (
  "user_id"    uuid        NOT NULL,
  "local_date" text        NOT NULL,
  "hour"       integer     NOT NULL,
  "last_at"    timestamptz NOT NULL,
  CONSTRAINT "user_chat_activity_pk" UNIQUE ("user_id", "local_date", "hour"),
  CONSTRAINT "user_chat_activity_hour" CHECK ("hour" >= 0 AND "hour" <= 23)
);
