-- 0066_play_wishlist.sql（T-092）：心愿清单（PLAY-04）——清单项与角色提议。文字按用户数据密钥加密。
CREATE TABLE "play"."wishlist_items" (
  "id"                    uuid        PRIMARY KEY,
  "user_id"               uuid        NOT NULL,
  "character_id"          uuid        NOT NULL,
  "text_ciphertext"       bytea       NOT NULL,
  "proposed_by_character" boolean     NOT NULL DEFAULT false,
  "due_date"              date,
  "completed_at"          timestamptz,
  "first_completed_at"    timestamptz,
  "card_issued"           boolean     NOT NULL DEFAULT false,
  "followed_up_at"        timestamptz,
  "source_key"            uuid        NOT NULL,
  "created_at"            timestamptz NOT NULL,
  "updated_at"            timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "wishlist_items_source_idx" ON "play"."wishlist_items" ("user_id","source_key");
-- statement-breakpoint
CREATE INDEX "wishlist_items_user_character_idx" ON "play"."wishlist_items" ("user_id","character_id","created_at");
-- statement-breakpoint
CREATE TABLE "play"."wishlist_proposals" (
  "id"              uuid        PRIMARY KEY,
  "user_id"         uuid        NOT NULL,
  "character_id"    uuid        NOT NULL,
  "text_ciphertext" bytea       NOT NULL,
  "week_start"      date        NOT NULL,
  "status"          text        NOT NULL DEFAULT 'pending',
  "item_id"         uuid,
  "idempotency_key" text        NOT NULL,
  "created_at"      timestamptz NOT NULL,
  "updated_at"      timestamptz NOT NULL,
  CONSTRAINT "wishlist_proposal_status" CHECK ("status" IN ('pending','accepted','declined'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "wishlist_proposals_idem_idx" ON "play"."wishlist_proposals" ("user_id","character_id","idempotency_key");
-- statement-breakpoint
CREATE INDEX "wishlist_proposals_week_idx" ON "play"."wishlist_proposals" ("user_id","character_id","week_start");
