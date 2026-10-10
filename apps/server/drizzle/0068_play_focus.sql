-- 0068_play_focus.sql（T-094）：陪你专注（PLAY-06）。同一用户同一时间只能有一个进行中；没有失败状态、不存累计时长。
CREATE TABLE "play"."focus_sessions" (
  "id"                uuid        PRIMARY KEY,
  "user_id"           uuid        NOT NULL,
  "character_id"      uuid        NOT NULL,
  "planned_minutes"   integer     NOT NULL,
  "note_ciphertext"   bytea,
  "started_at"        timestamptz NOT NULL,
  "ends_at"           timestamptz NOT NULL,
  "ended_at"          timestamptz,
  "result"            text        NOT NULL DEFAULT 'in_progress',
  "client_request_id" uuid        NOT NULL,
  "updated_at"        timestamptz NOT NULL,
  CONSTRAINT "focus_minutes" CHECK ("planned_minutes" BETWEEN 5 AND 120),
  CONSTRAINT "focus_result" CHECK ("result" IN ('in_progress','completed','ended_early'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "focus_sessions_request_idx" ON "play"."focus_sessions" ("user_id","client_request_id");
-- statement-breakpoint
CREATE UNIQUE INDEX "focus_sessions_one_active_idx" ON "play"."focus_sessions" ("user_id") WHERE "result" = 'in_progress';
-- statement-breakpoint
CREATE INDEX "focus_sessions_due_idx" ON "play"."focus_sessions" ("result","ends_at");
