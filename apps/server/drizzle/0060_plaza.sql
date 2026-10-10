-- 0060_plaza.sql
-- T-087 plaza 人设广场（persona-plaza.md 第 3 节）：作者档案、停权、作品、版本快照（只增不改）、发布草稿、复制 / 应用关系。
CREATE SCHEMA IF NOT EXISTS "plaza";
-- statement-breakpoint
CREATE TABLE "plaza"."author_profiles" (
  "user_id"           uuid        PRIMARY KEY,
  "author_id"         uuid        NOT NULL UNIQUE,
  "nickname"          text        NOT NULL,
  "avatar_media_id"   uuid,
  "created_at"        timestamptz NOT NULL,
  "updated_at"        timestamptz NOT NULL,
  CONSTRAINT "author_nickname_len" CHECK (char_length("nickname") BETWEEN 1 AND 12)
);
-- statement-breakpoint
CREATE TABLE "plaza"."bans" (
  "user_id"     uuid        PRIMARY KEY,
  "until"       timestamptz,
  "permanent"   boolean     NOT NULL DEFAULT false,
  "reason"      text        NOT NULL,
  "created_by"  uuid        NOT NULL,
  "created_at"  timestamptz NOT NULL,
  CONSTRAINT "ban_until" CHECK ("permanent" OR "until" IS NOT NULL)
);
-- statement-breakpoint
CREATE TABLE "plaza"."works" (
  "id"                      uuid        PRIMARY KEY,
  "author_user_id"          uuid        NOT NULL,
  "kind"                    text        NOT NULL,
  "source_character_id"     uuid        NOT NULL,
  "based_on_preset_id"      uuid,
  "based_on_preset_name"    text,
  "origin_work_id"          uuid,
  "origin_work_name"        text,
  "origin_author_user_id"   uuid,
  "origin_author_nickname"  text,
  "name"                    text        NOT NULL,
  "basis"                   text,
  "tags"                    text[]      NOT NULL DEFAULT '{}',
  "avatar_media_id"         uuid,
  "tagline"                 text        NOT NULL,
  "publish_note"            text        NOT NULL DEFAULT '',
  "allow_remix"             boolean     NOT NULL DEFAULT true,
  "comments_open"           boolean     NOT NULL DEFAULT true,
  "current_version"         integer     NOT NULL DEFAULT 1,
  "status"                  text        NOT NULL DEFAULT 'listed',
  "removed_reason"          text,
  "like_count"              integer     NOT NULL DEFAULT 0,
  "adopt_count"             integer     NOT NULL DEFAULT 0,
  "comment_count"           integer     NOT NULL DEFAULT 0,
  "published_at"            timestamptz NOT NULL,
  "updated_at"              timestamptz NOT NULL,
  CONSTRAINT "work_kind" CHECK ("kind" IN ('custom_character','preset_variant')),
  CONSTRAINT "work_status" CHECK ("status" IN ('listed','unlisted_by_author','removed_by_admin')),
  CONSTRAINT "work_tagline_len" CHECK (char_length("tagline") BETWEEN 1 AND 30),
  CONSTRAINT "work_note_len" CHECK (char_length("publish_note") <= 300)
);
-- statement-breakpoint
-- PLZ-02 第 9 条：一个自定义角色 / 一份补充设定只对应一个作品。
CREATE UNIQUE INDEX "works_source_idx" ON "plaza"."works" ("author_user_id","kind","source_character_id");
-- statement-breakpoint
CREATE INDEX "works_author_idx" ON "plaza"."works" ("author_user_id","published_at" DESC);
-- statement-breakpoint
CREATE INDEX "works_origin_idx" ON "plaza"."works" ("origin_work_id") WHERE "origin_work_id" IS NOT NULL;
-- statement-breakpoint
CREATE INDEX "works_listed_idx" ON "plaza"."works" ("published_at" DESC) WHERE "status" = 'listed';
-- statement-breakpoint
CREATE TABLE "plaza"."work_versions" (
  "work_id"         uuid        NOT NULL REFERENCES "plaza"."works"("id") ON DELETE CASCADE,
  "version"         integer     NOT NULL,
  "snapshot"        jsonb       NOT NULL,
  "settings"        jsonb       NOT NULL,
  "classification"  jsonb,
  "change_note"     text,
  "created_at"      timestamptz NOT NULL,
  PRIMARY KEY ("work_id","version"),
  CONSTRAINT "version_note_len" CHECK ("change_note" IS NULL OR char_length("change_note") <= 100)
);
-- statement-breakpoint
-- 版本快照只增不改（persona-plaza.md 第 3 节）；删除作品时随作品级联删除。
CREATE FUNCTION "plaza"."work_versions_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'plaza.work_versions 只增不改：禁止 UPDATE（请发布新版本）'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- statement-breakpoint
CREATE TRIGGER "work_versions_no_update"
  BEFORE UPDATE ON "plaza"."work_versions"
  FOR EACH ROW EXECUTE FUNCTION "plaza"."work_versions_append_only"();
-- statement-breakpoint
CREATE TABLE "plaza"."publish_drafts" (
  "id"                       uuid        PRIMARY KEY,
  "user_id"                  uuid        NOT NULL,
  "work_id"                  uuid,
  "source"                   jsonb       NOT NULL,
  "snapshot"                 jsonb       NOT NULL,
  "spans"                    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "child_features_detected"  boolean     NOT NULL DEFAULT false,
  "origin_work_id"           uuid,
  "consumed_work_id"         uuid,
  "expires_at"               timestamptz NOT NULL,
  "created_at"               timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX "publish_drafts_user_idx" ON "plaza"."publish_drafts" ("user_id","created_at" DESC);
-- statement-breakpoint
CREATE INDEX "publish_drafts_expires_idx" ON "plaza"."publish_drafts" ("expires_at");
-- statement-breakpoint
-- 复制 / 应用关系：不随作品删除（属于复制者，PLZ-06 第 3 条），所以不建外键。
CREATE TABLE "plaza"."adoptions" (
  "id"                        uuid        PRIMARY KEY,
  "user_id"                   uuid        NOT NULL,
  "work_id"                   uuid        NOT NULL,
  "version"                   integer     NOT NULL,
  "kind"                      text        NOT NULL,
  "character_id"              uuid        NOT NULL,
  "update_dismissed_version"  integer     NOT NULL DEFAULT 0,
  "created_at"                timestamptz NOT NULL,
  "updated_at"                timestamptz NOT NULL,
  CONSTRAINT "adoption_kind" CHECK ("kind" IN ('copy','apply'))
);
-- statement-breakpoint
CREATE INDEX "adoptions_work_idx" ON "plaza"."adoptions" ("work_id","created_at");
-- statement-breakpoint
CREATE INDEX "adoptions_user_idx" ON "plaza"."adoptions" ("user_id","character_id");
