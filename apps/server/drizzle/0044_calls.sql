-- 0044_calls.sql
-- T-070 语音通话会话（MED-06、MED-07，ADR-0025）。每个用户同一时间最多一通未结束的通话（部分唯一索引）。
-- statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "calls";
-- statement-breakpoint
CREATE TABLE "calls"."call_sessions" (
  "id"                 uuid        PRIMARY KEY,
  "user_id"            uuid        NOT NULL,
  "character_id"       uuid        NOT NULL,
  "conversation_id"    uuid        NOT NULL,
  "direction"          text        NOT NULL,
  "state"              text        NOT NULL,
  "outcome"            text,
  "request_key"        text        NOT NULL,
  "created_at"         timestamptz NOT NULL,
  "answered_at"        timestamptz,
  "ended_at"           timestamptz,
  "duration_sec"       integer     NOT NULL DEFAULT 0,
  "stream_connection"  text,
  "stream_lost_at"     timestamptz,
  "balance_low_at"     timestamptz
);
-- statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_request_uq" ON "calls"."call_sessions" ("user_id", "request_key");
-- statement-breakpoint
CREATE UNIQUE INDEX "call_sessions_one_open_uq" ON "calls"."call_sessions" ("user_id") WHERE "state" <> 'ended';
-- statement-breakpoint
CREATE INDEX "call_sessions_open_idx" ON "calls"."call_sessions" ("state") WHERE "state" <> 'ended';
