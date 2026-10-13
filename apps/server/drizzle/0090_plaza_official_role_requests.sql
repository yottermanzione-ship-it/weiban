-- 0090_plaza_official_role_requests.sql（总经理 10-14 裁定 2.3，契约 3.5）
-- 1) 角色广场「微伴角色」tab：官方预设角色的点赞、评论（character_id 指 characters.characters 的预设角色，跨模块不加外键）。
-- 2) 角色创建 › 申请制作：用户提交、管理员处理的制作申请；plaza.settings 存申请配置（键 role_request_config）。
CREATE TABLE IF NOT EXISTS "plaza"."official_likes" (
  "character_id"  uuid        NOT NULL,
  "user_id"       uuid        NOT NULL,
  "created_at"    timestamptz NOT NULL,
  CONSTRAINT "official_likes_pk" PRIMARY KEY ("character_id", "user_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_likes_user_idx" ON "plaza"."official_likes" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plaza"."official_comments" (
  "id"                   uuid        PRIMARY KEY,
  "character_id"         uuid        NOT NULL,
  "author_user_id"       uuid        NOT NULL,
  "client_request_id"    uuid        NOT NULL,
  "reply_to_comment_id"  uuid,
  "reply_to_user_id"     uuid,
  "text"                 text        NOT NULL,
  "created_at"           timestamptz NOT NULL,
  "deleted_at"           timestamptz,
  "deleted_by"           text,
  CONSTRAINT "official_comment_len" CHECK (char_length("text") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "official_comments_client_idx" ON "plaza"."official_comments" ("author_user_id", "client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_comments_character_idx" ON "plaza"."official_comments" ("character_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "official_comments_created_idx" ON "plaza"."official_comments" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plaza"."role_requests" (
  "id"                   uuid        PRIMARY KEY,
  "user_id"              uuid        NOT NULL,
  "client_request_id"    uuid        NOT NULL,
  "role_name"            text        NOT NULL,
  "basis"                text,
  "category_id"          text,
  "source_work"          text        NOT NULL DEFAULT '',
  "reference_text"       text        NOT NULL DEFAULT '',
  "reference_media_ids"  uuid[]      NOT NULL DEFAULT '{}',
  "note"                 text        NOT NULL DEFAULT '',
  "status"               text        NOT NULL DEFAULT 'pending',
  "admin_message"        text,
  "character_id"         uuid,
  "added_to_contacts"    boolean     NOT NULL DEFAULT false,
  "points_cost"          integer     NOT NULL DEFAULT 0,
  "points_charged"       integer     NOT NULL DEFAULT 0,
  "handled_by"           uuid,
  "history"              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "user_unseen"          boolean     NOT NULL DEFAULT false,
  "created_at"           timestamptz NOT NULL,
  "updated_at"           timestamptz NOT NULL,
  CONSTRAINT "role_request_status" CHECK ("status" IN ('pending', 'in_progress', 'completed', 'rejected', 'cancelled')),
  CONSTRAINT "role_request_points" CHECK ("points_cost" >= 0 AND "points_charged" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "role_requests_client_idx" ON "plaza"."role_requests" ("user_id", "client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_requests_user_idx" ON "plaza"."role_requests" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_requests_status_idx" ON "plaza"."role_requests" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plaza"."settings" (
  "key"         text        PRIMARY KEY,
  "value"       jsonb       NOT NULL,
  "updated_at"  timestamptz NOT NULL
);
