-- 0086_announcements_release_notes.sql
-- 换壳 UI 批次：公告、更新说明、版本策略（契约 3.2 http/announcements.ts，说明见 docs/backend/announcements.md）。
-- 数据归 identity；用户相关的两张表（已读回执、看过的版本）随账号删除级联删除。
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity"."announcements" (
  "id"           uuid        PRIMARY KEY,
  "title"        text        NOT NULL,
  "body"         text        NOT NULL,
  "platforms"    text[]      NOT NULL DEFAULT '{}'::text[],
  "starts_at"    timestamptz,
  "ends_at"      timestamptz,
  "popup"        boolean     NOT NULL DEFAULT false,
  "pinned"       boolean     NOT NULL DEFAULT false,
  "status"       text        NOT NULL DEFAULT 'draft',
  "published_at" timestamptz,
  "withdrawn_at" timestamptz,
  "created_by"   uuid,
  "created_at"   timestamptz NOT NULL,
  "updated_at"   timestamptz NOT NULL,
  CONSTRAINT "announcements_status_check" CHECK ("status" IN ('draft', 'published', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_status_idx" ON "identity"."announcements" ("status", "published_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity"."announcement_reads" (
  "announcement_id" uuid        NOT NULL REFERENCES "identity"."announcements"("id") ON DELETE CASCADE,
  "user_id"         uuid        NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "read_at"         timestamptz NOT NULL,
  PRIMARY KEY ("announcement_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcement_reads_user_idx" ON "identity"."announcement_reads" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity"."release_notes" (
  "id"           uuid        PRIMARY KEY,
  "platform"     text        NOT NULL,
  "version"      text        NOT NULL,
  "version_code" integer     NOT NULL,
  "title"        text        NOT NULL DEFAULT '',
  "body"         text        NOT NULL,
  "published"    boolean     NOT NULL DEFAULT true,
  "published_at" timestamptz,
  "created_at"   timestamptz NOT NULL,
  "updated_at"   timestamptz NOT NULL,
  CONSTRAINT "release_notes_platform_check" CHECK ("platform" IN ('web', 'android'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "release_notes_platform_code_uq" ON "identity"."release_notes" ("platform", "version_code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity"."app_version_policies" (
  "platform"                   text        PRIMARY KEY,
  "latest_version"             text,
  "latest_version_code"        integer,
  "download_url"               text,
  "min_supported_version_code" integer,
  "force_update_message"       text,
  "updated_at"                 timestamptz NOT NULL,
  CONSTRAINT "app_version_policies_platform_check" CHECK ("platform" IN ('web', 'android'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "identity"."release_note_seen" (
  "user_id"      uuid        NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "platform"     text        NOT NULL,
  "version_code" integer     NOT NULL,
  "updated_at"   timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "platform")
);
