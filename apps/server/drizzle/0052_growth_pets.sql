-- 0052_growth_pets.sql
-- T-077 共同领养宠物（PLAY-02）与宠物图鉴（ADM-04 第 5 条）。
-- statement-breakpoint
CREATE TABLE "growth"."pet_species" (
  "id"           uuid        PRIMARY KEY,
  "name"         text        NOT NULL,
  "intro"        text        NOT NULL DEFAULT '',
  "preset_names" text[]      NOT NULL DEFAULT '{}'::text[],
  "listed"       boolean     NOT NULL DEFAULT true,
  "created_at"   timestamptz NOT NULL,
  "updated_at"   timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE "growth"."pet_appearances" (
  "id"              uuid        PRIMARY KEY,
  "species_id"      uuid        NOT NULL,
  "name"            text        NOT NULL,
  "baby_media_id"   uuid        NOT NULL,
  "junior_media_id" uuid        NOT NULL,
  "adult_media_id"  uuid        NOT NULL,
  "sort_order"      integer     NOT NULL DEFAULT 0,
  "created_at"      timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "pet_appearances_species_idx" ON "growth"."pet_appearances" ("species_id");
-- statement-breakpoint
CREATE TABLE "growth"."pets" (
  "id"                  uuid        PRIMARY KEY,
  "user_id"             uuid        NOT NULL,
  "character_id"        uuid        NOT NULL,
  "species_id"          uuid        NOT NULL,
  "appearance_id"       uuid        NOT NULL,
  "name"                text        NOT NULL,
  "stage"               text        NOT NULL DEFAULT 'baby',
  "adopted_on"          date        NOT NULL,
  "intimacy"            integer     NOT NULL DEFAULT 0,
  "allow_moments_share" boolean     NOT NULL DEFAULT true,
  "status"              text        NOT NULL DEFAULT 'active',
  "sent_away_at"        timestamptz,
  "named_by_character"  boolean     NOT NULL DEFAULT false,
  "client_request_id"   uuid        NOT NULL,
  "created_at"          timestamptz NOT NULL,
  "updated_at"          timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "pets_user_request_uq" ON "growth"."pets" ("user_id", "client_request_id");
-- statement-breakpoint
CREATE UNIQUE INDEX "pets_one_active_per_character_uq" ON "growth"."pets" ("user_id", "character_id") WHERE "status" = 'active';
-- statement-breakpoint
CREATE INDEX "pets_user_idx" ON "growth"."pets" ("user_id");
-- statement-breakpoint
CREATE INDEX "pets_status_idx" ON "growth"."pets" ("status");
-- statement-breakpoint
CREATE TABLE "growth"."pet_interactions" (
  "id"               uuid        PRIMARY KEY,
  "pet_id"           uuid        NOT NULL,
  "user_id"          uuid        NOT NULL,
  "kind"             text        NOT NULL,
  "local_date"       date        NOT NULL,
  "counted"          boolean     NOT NULL,
  "client_action_id" uuid        NOT NULL,
  "created_at"       timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "pet_interactions_action_uq" ON "growth"."pet_interactions" ("pet_id", "client_action_id");
-- statement-breakpoint
CREATE INDEX "pet_interactions_pet_date_idx" ON "growth"."pet_interactions" ("pet_id", "local_date");
-- statement-breakpoint
CREATE TABLE "growth"."pet_timeline" (
  "id"      uuid        PRIMARY KEY,
  "pet_id"  uuid        NOT NULL,
  "user_id" uuid        NOT NULL,
  "kind"    text        NOT NULL,
  "detail"  jsonb       NOT NULL,
  "at"      timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "pet_timeline_pet_idx" ON "growth"."pet_timeline" ("pet_id", "at");
-- statement-breakpoint
CREATE TABLE "growth"."pet_album" (
  "id"         uuid        PRIMARY KEY,
  "pet_id"     uuid        NOT NULL,
  "user_id"    uuid        NOT NULL,
  "media_id"   uuid        NOT NULL,
  "source"     text        NOT NULL,
  "message_id" uuid,
  "created_at" timestamptz NOT NULL
);
-- statement-breakpoint
CREATE UNIQUE INDEX "pet_album_media_uq" ON "growth"."pet_album" ("pet_id", "media_id");
-- statement-breakpoint
CREATE INDEX "pet_album_pet_idx" ON "growth"."pet_album" ("pet_id", "created_at");
-- statement-breakpoint
CREATE TABLE "growth"."pet_naming_requests" (
  "id"            uuid        PRIMARY KEY,
  "user_id"       uuid        NOT NULL,
  "character_id"  uuid        NOT NULL,
  "species_id"    uuid        NOT NULL,
  "appearance_id" uuid        NOT NULL,
  "status"        text        NOT NULL DEFAULT 'pending',
  "names"         text[]      NOT NULL DEFAULT '{}'::text[],
  "chosen_index"  integer,
  "created_at"    timestamptz NOT NULL,
  "updated_at"    timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "pet_naming_requests_user_idx" ON "growth"."pet_naming_requests" ("user_id", "character_id");
