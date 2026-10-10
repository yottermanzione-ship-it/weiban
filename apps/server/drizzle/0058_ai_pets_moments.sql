-- 0058_ai_pets_moments.sql（T-082）：角色提议领养只提一次（PLAY-02 第 2 条）；名场面每角色每周只评估一次（GRW-05）。
CREATE TABLE IF NOT EXISTS "ai_runtime"."pet_proposals" (
  "user_id" uuid NOT NULL,
  "character_id" uuid NOT NULL,
  "proposed_at" timestamptz NOT NULL,
  "message_id" uuid,
  "choice" text,
  "chosen_at" timestamptz,
  PRIMARY KEY ("user_id", "character_id")
);
CREATE TABLE IF NOT EXISTS "ai_runtime"."moment_card_attempts" (
  "user_id" uuid NOT NULL,
  "character_id" uuid NOT NULL,
  "week_key" text NOT NULL,
  "outcome" text NOT NULL,
  "score" integer,
  "card_id" uuid,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "character_id", "week_key")
);
