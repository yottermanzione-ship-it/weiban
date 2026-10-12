-- 0067_play_letters.sql（T-093）：慢信（PLAY-05）——来信、回信、角色主动寄的信与草稿。正文按用户数据密钥加密。
CREATE TABLE "play"."letters" (
  "id"                    uuid        PRIMARY KEY,
  "user_id"               uuid        NOT NULL,
  "character_id"          uuid        NOT NULL,
  "direction"             text        NOT NULL,
  "status"                text        NOT NULL,
  "body_ciphertext"       bytea,
  "reply_state"           text,
  "in_reply_to_letter_id" uuid,
  "deliver_at"            timestamptz,
  "deliver_local_date"    date,
  "sent_at"               timestamptz,
  "delivered_at"          timestamptz,
  "read_at"               timestamptz,
  "message_id"            uuid,
  "idempotency_key"       text,
  "created_at"            timestamptz NOT NULL,
  "updated_at"            timestamptz NOT NULL,
  CONSTRAINT "letter_direction" CHECK ("direction" IN ('to_character','from_character')),
  CONSTRAINT "letter_status" CHECK ("status" IN ('draft','sent','in_transit','delivered')),
  CONSTRAINT "letter_reply_state" CHECK ("reply_state" IS NULL OR "reply_state" IN ('pending_body','body_ready'))
);
-- statement-breakpoint
CREATE INDEX "letters_user_box_idx" ON "play"."letters" ("user_id","direction","status","created_at" DESC);
-- statement-breakpoint
CREATE INDEX "letters_due_idx" ON "play"."letters" ("status","reply_state","deliver_at");
-- statement-breakpoint
CREATE INDEX "letters_character_day_idx" ON "play"."letters" ("user_id","character_id","deliver_local_date");
-- statement-breakpoint
CREATE UNIQUE INDEX "letters_idempotency_idx" ON "play"."letters" ("user_id","character_id","idempotency_key") WHERE "idempotency_key" IS NOT NULL;
-- statement-breakpoint
CREATE UNIQUE INDEX "letters_one_draft_idx" ON "play"."letters" ("user_id","character_id") WHERE "status" = 'draft';
