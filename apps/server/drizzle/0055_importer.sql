-- 0055_importer.sql
-- T-079 importer：导入任务与加密暂存的原文（CHR-08，security-and-privacy.md 5.3）；
-- characters：我的补充设定（CHR-09）与「资料已更新」已读位置（CHR-10 第 4 条）。
CREATE SCHEMA IF NOT EXISTS "importer";
-- statement-breakpoint
CREATE TABLE "importer"."import_jobs" (
  "id"                  uuid        PRIMARY KEY,
  "user_id"             uuid        NOT NULL,
  "client_request_id"   uuid        NOT NULL,
  "kind"                text        NOT NULL,
  "target_character_id" uuid,
  "source_kind"         text        NOT NULL,
  "status"              text        NOT NULL,
  "speakers"            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "selected_speaker"    text,
  "char_count"          integer     NOT NULL DEFAULT 0,
  "truncated"           boolean     NOT NULL DEFAULT false,
  "screenshot_count"    integer     NOT NULL DEFAULT 0,
  "estimated_micros"    bigint,
  "progress"            integer     NOT NULL DEFAULT 0,
  "keep_raw"            boolean     NOT NULL DEFAULT false,
  "raw_deleted_at"      timestamptz,
  "failure"             text,
  "result_ciphertext"   bytea,
  "created_at"          timestamptz NOT NULL,
  "updated_at"          timestamptz NOT NULL,
  CONSTRAINT "import_job_kind" CHECK ("kind" IN ('new_character','supplement')),
  CONSTRAINT "import_job_source" CHECK ("source_kind" IN ('text','file','screenshots'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "import_jobs_client_idx" ON "importer"."import_jobs" ("user_id","client_request_id");
-- statement-breakpoint
CREATE INDEX "import_jobs_user_idx" ON "importer"."import_jobs" ("user_id","created_at" DESC);
-- statement-breakpoint
CREATE TABLE "importer"."import_raw" (
  "id"         uuid        PRIMARY KEY,
  "job_id"     uuid        NOT NULL REFERENCES "importer"."import_jobs"("id") ON DELETE CASCADE,
  "user_id"    uuid        NOT NULL,
  "part"       text        NOT NULL,
  "seq"        integer     NOT NULL DEFAULT 0,
  "media_id"   uuid,
  "ciphertext" bytea,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "import_raw_part" CHECK ("part" IN ('text','lines','screenshot'))
);
-- statement-breakpoint
CREATE INDEX "import_raw_job_idx" ON "importer"."import_raw" ("job_id","part","seq");
-- statement-breakpoint
CREATE INDEX "import_raw_created_idx" ON "importer"."import_raw" ("created_at");
-- statement-breakpoint
CREATE TABLE "characters"."user_supplements" (
  "user_id"         uuid        NOT NULL,
  "character_id"    uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "text_ciphertext" bytea       NOT NULL,
  "conflicts"       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "plaza_source"    jsonb,
  "updated_at"      timestamptz NOT NULL,
  PRIMARY KEY ("user_id","character_id")
);
-- statement-breakpoint
CREATE TABLE "characters"."persona_update_seen" (
  "user_id"      uuid        NOT NULL,
  "character_id" uuid        NOT NULL REFERENCES "characters"."characters"("id") ON DELETE CASCADE,
  "seen_version" integer     NOT NULL,
  "updated_at"   timestamptz NOT NULL,
  PRIMARY KEY ("user_id","character_id")
);
