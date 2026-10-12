-- 0074（契约 3.1，积压 ㊱）：作者已读位置，供「我发布的」逐作品红点 unreadCount；removed_reason 已有列。
ALTER TABLE "plaza"."works" ADD COLUMN IF NOT EXISTS "author_seen_at" timestamptz;
CREATE INDEX IF NOT EXISTS "likes_work_created_idx" ON "plaza"."likes" ("work_id", "created_at");
CREATE INDEX IF NOT EXISTS "bans_active_idx" ON "plaza"."bans" ("created_at");
