-- 0074 回滚
DROP INDEX IF EXISTS "plaza"."bans_active_idx";
DROP INDEX IF EXISTS "plaza"."likes_work_created_idx";
ALTER TABLE "plaza"."works" DROP COLUMN IF EXISTS "author_seen_at";
