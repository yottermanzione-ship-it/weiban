-- 0033_contact_card_recommendations.sql
-- T-064 名片推荐账本（CHR-04、P-27）：所有角色合计每 7 天最多主动推荐 1 次；「不感兴趣」后该角色冷却 90 天。
-- statement-breakpoint
CREATE TABLE "contacts"."card_recommendations" (
  "id"                        uuid        PRIMARY KEY,
  "user_id"                   uuid        NOT NULL,
  "character_id"              uuid        NOT NULL,
  "recommender_character_id"  uuid        NOT NULL,
  "message_id"                uuid        NOT NULL,
  "created_at"                timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "card_recommendations_message_idx" ON "contacts"."card_recommendations" ("user_id", "message_id");
-- statement-breakpoint
CREATE INDEX "card_recommendations_user_idx" ON "contacts"."card_recommendations" ("user_id", "created_at");
-- statement-breakpoint
CREATE TABLE "contacts"."card_dismissals" (
  "user_id"        uuid        NOT NULL,
  "character_id"   uuid        NOT NULL,
  "dismissed_at"   timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "character_id")
);
