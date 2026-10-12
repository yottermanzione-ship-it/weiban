-- 0061_plaza_interactions.sql
-- T-087：点赞、评论（一层回复）、举报、广场通知（红点，不推送，PLZ-03 第 4 条）。
CREATE TABLE "plaza"."likes" (
  "work_id"    uuid        NOT NULL REFERENCES "plaza"."works"("id") ON DELETE CASCADE,
  "user_id"    uuid        NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("work_id","user_id")
);
-- statement-breakpoint
CREATE INDEX "likes_user_idx" ON "plaza"."likes" ("user_id");
-- statement-breakpoint
CREATE INDEX "likes_recent_idx" ON "plaza"."likes" ("work_id","created_at");
-- statement-breakpoint
CREATE TABLE "plaza"."comments" (
  "id"                   uuid        PRIMARY KEY,
  "work_id"              uuid        NOT NULL REFERENCES "plaza"."works"("id") ON DELETE CASCADE,
  "author_user_id"       uuid        NOT NULL,
  "client_request_id"    uuid        NOT NULL,
  "reply_to_comment_id"  uuid,
  "reply_to_user_id"     uuid,
  "text"                 text        NOT NULL,
  "created_at"           timestamptz NOT NULL,
  "deleted_at"           timestamptz,
  "deleted_by"           text,
  CONSTRAINT "comment_text_len" CHECK (char_length("text") BETWEEN 1 AND 200),
  CONSTRAINT "comment_deleted_by" CHECK ("deleted_by" IS NULL OR "deleted_by" IN ('commenter','work_author','admin'))
);
-- statement-breakpoint
CREATE UNIQUE INDEX "comments_client_idx" ON "plaza"."comments" ("author_user_id","client_request_id");
-- statement-breakpoint
CREATE INDEX "comments_work_idx" ON "plaza"."comments" ("work_id","created_at","id");
-- statement-breakpoint
CREATE TABLE "plaza"."reports" (
  "id"                 uuid        PRIMARY KEY,
  "reporter_user_id"   uuid        NOT NULL,
  "target_kind"        text        NOT NULL,
  "target_id"          uuid        NOT NULL,
  "work_id"            uuid        NOT NULL,
  "reason"             text        NOT NULL,
  "note"               text,
  "status"             text        NOT NULL DEFAULT 'pending',
  "resolution_reason"  text,
  "resolved_by"        uuid,
  "resolved_at"        timestamptz,
  "created_at"         timestamptz NOT NULL,
  CONSTRAINT "report_target_kind" CHECK ("target_kind" IN ('work','comment')),
  CONSTRAINT "report_reason" CHECK ("reason" IN ('rights','hard_boundary','inappropriate','other')),
  CONSTRAINT "report_status" CHECK ("status" IN ('pending','dismissed','actioned')),
  CONSTRAINT "report_note_len" CHECK ("note" IS NULL OR char_length("note") <= 200)
);
-- statement-breakpoint
-- PLZ-07 第 2 条：同一用户对同一对象只能举报一次。
CREATE UNIQUE INDEX "reports_once_idx" ON "plaza"."reports" ("reporter_user_id","target_kind","target_id");
-- statement-breakpoint
CREATE INDEX "reports_status_idx" ON "plaza"."reports" ("status","created_at" DESC);
-- statement-breakpoint
CREATE INDEX "reports_work_idx" ON "plaza"."reports" ("work_id");
-- statement-breakpoint
CREATE TABLE "plaza"."notices" (
  "id"          uuid        PRIMARY KEY,
  "user_id"     uuid        NOT NULL,
  "kind"        text        NOT NULL,
  "work_id"     uuid,
  "text"        text        NOT NULL,
  "seen"        boolean     NOT NULL DEFAULT false,
  "created_at"  timestamptz NOT NULL,
  CONSTRAINT "notice_kind" CHECK ("kind" IN ('work_liked','work_commented','comment_replied','report_resolved','work_removed_by_admin'))
);
-- statement-breakpoint
CREATE INDEX "notices_user_idx" ON "plaza"."notices" ("user_id","created_at" DESC);
-- statement-breakpoint
CREATE INDEX "notices_unseen_idx" ON "plaza"."notices" ("user_id","kind") WHERE NOT "seen";
