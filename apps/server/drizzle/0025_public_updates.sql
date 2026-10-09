-- 0025_public_updates.sql
-- D-L3-02：公开动态录入、审核状态机与自动候选（SIM-03、ADM-03）。
-- 状态：draft / pending / effective / rejected / withdrawn；来源：manual / auto_search。
-- 只有 effective 的动态会经 PublicUpdateReadPort 给 AI 运行时（hard-boundaries.md SAFE-02）。
-- statement-breakpoint
CREATE TABLE "characters"."public_updates" (
  "id"             uuid        PRIMARY KEY,
  "character_id"   uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "kind"           text        NOT NULL,
  "content"        text        NOT NULL,
  "start_date"     text        NOT NULL,
  "end_date"       text,
  "effective_date" text        NOT NULL,
  "source_url"     text        NOT NULL,
  "source_key"     text        NOT NULL,
  "source"         text        NOT NULL,
  "status"         text        NOT NULL,
  "review_note"    text,
  "created_by"     uuid,
  "reviewed_by"    uuid,
  "reviewed_at"    timestamptz,
  "created_at"     timestamptz NOT NULL,
  "updated_at"     timestamptz NOT NULL,
  CONSTRAINT "public_updates_kind_check" CHECK ("kind" IN ('new_work', 'event', 'award', 'other')),
  CONSTRAINT "public_updates_source_check" CHECK ("source" IN ('manual', 'auto_search')),
  CONSTRAINT "public_updates_status_check" CHECK (
    "status" IN ('draft', 'pending', 'effective', 'rejected', 'withdrawn')
  ),
  CONSTRAINT "public_updates_dates_check" CHECK (
    "start_date" ~ '^\d{4}-\d{2}-\d{2}$'
    AND "effective_date" ~ '^\d{4}-\d{2}-\d{2}$'
    AND ("end_date" IS NULL OR ("end_date" ~ '^\d{4}-\d{2}-\d{2}$' AND "end_date" >= "start_date"))
  ),
  CONSTRAINT "public_updates_content_check" CHECK (char_length("content") BETWEEN 1 AND 500)
);
-- statement-breakpoint
CREATE INDEX "public_updates_status_idx" ON "characters"."public_updates" ("status", "created_at");
CREATE INDEX "public_updates_character_idx" ON "characters"."public_updates" ("character_id", "status", "start_date");
CREATE INDEX "public_updates_source_key_idx" ON "characters"."public_updates" ("character_id", "source_key");
-- statement-breakpoint
CREATE TABLE "characters"."public_update_settings" (
  "id"                  text        PRIMARY KEY,
  "auto_search_enabled" boolean     NOT NULL,
  "last_auto_run_at"    timestamptz,
  "updated_at"          timestamptz NOT NULL
);
