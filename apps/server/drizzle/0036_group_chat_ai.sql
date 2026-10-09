-- 0036_group_chat_ai.sql
-- T-065 L4 群聊 AI：群陪伴设置、群里自己聊账本（P-20）、角色拉群账本（P-22）。
CREATE TABLE "ai_runtime"."group_companion_settings" (
  "conversation_id"   uuid        PRIMARY KEY NOT NULL,
  "user_id"           uuid        NOT NULL,
  "instant_reply"     boolean     NOT NULL DEFAULT false,
  "self_chat_enabled" boolean     NOT NULL DEFAULT true,
  "scenario_mode"     text        NOT NULL DEFAULT 'daily',
  "updated_at"        timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."group_self_chats" (
  "conversation_id"      uuid        NOT NULL,
  "user_id"              uuid        NOT NULL,
  "local_date"           text        NOT NULL,
  "starter_character_id" uuid,
  "source_ref"           text,
  "messages"             integer     NOT NULL DEFAULT 0,
  "created_at"           timestamptz NOT NULL,
  CONSTRAINT "group_self_chat_day_idx" UNIQUE ("conversation_id", "local_date"),
  CONSTRAINT "group_self_chat_messages" CHECK ("messages" >= 0 AND "messages" <= 10)
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."group_invites" (
  "id"                   uuid        PRIMARY KEY NOT NULL,
  "user_id"              uuid        NOT NULL,
  "inviter_character_id" uuid        NOT NULL,
  "conversation_id"      uuid,
  "trigger"              text        NOT NULL,
  "source_ref"           text        NOT NULL,
  "reason"               text        NOT NULL,
  "outcome"              text        NOT NULL,
  "created_at"           timestamptz NOT NULL,
  "left_at"              timestamptz,
  "exit_mentioned"       boolean     NOT NULL DEFAULT false,
  CONSTRAINT "group_invite_source_idx" UNIQUE ("user_id", "source_ref"),
  CONSTRAINT "group_invite_trigger" CHECK ("trigger" IN ('co_event','user_mention','holiday'))
);
--> statement-breakpoint
CREATE INDEX "group_invite_user_idx" ON "ai_runtime"."group_invites" ("user_id", "created_at");
