-- 0069_play_reminders.sql（T-095）：TA 的提醒（PLAY-07）。内容与预生成说法加密；到点不调用模型。
CREATE TABLE "play"."reminders" (
  "id"                        uuid        PRIMARY KEY,
  "user_id"                   uuid        NOT NULL,
  "character_id"              uuid        NOT NULL,
  "text_ciphertext"           bytea       NOT NULL,
  "time"                      text        NOT NULL,
  "repeat"                    text        NOT NULL,
  "health"                    boolean     NOT NULL DEFAULT false,
  "bypass_do_not_disturb"     boolean     NOT NULL DEFAULT false,
  "enabled"                   boolean     NOT NULL DEFAULT true,
  "phrasings_ciphertext"      bytea,
  "phrasings_ready"           boolean     NOT NULL DEFAULT false,
  "phrasing_cursor"           integer     NOT NULL DEFAULT 0,
  "next_fire_at"              timestamptz,
  "last_fired_at"             timestamptz,
  "paused_by_contact_removal" boolean     NOT NULL DEFAULT false,
  "client_request_id"         uuid        NOT NULL,
  "created_at"                timestamptz NOT NULL,
  "updated_at"                timestamptz NOT NULL,
  CONSTRAINT "reminder_time" CHECK ("time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
-- statement-breakpoint
CREATE UNIQUE INDEX "reminders_request_idx" ON "play"."reminders" ("user_id","client_request_id");
-- statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "play"."reminders" ("user_id","created_at");
-- statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "play"."reminders" ("enabled","paused_by_contact_removal","next_fire_at");
