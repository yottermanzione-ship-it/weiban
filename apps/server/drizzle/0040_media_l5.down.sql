-- 0040_media_l5.down.sql（音频行没有宽高，回滚前删除）
DELETE FROM "media"."objects" WHERE "width" IS NULL OR "height" IS NULL;
DROP INDEX IF EXISTS "media"."objects_expires_idx";
ALTER TABLE "media"."objects" DROP CONSTRAINT IF EXISTS "objects_thumb_storage_key_unique";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "expires_at";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "content_hash";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "transcript_ciphertext";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "transcript_status";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "duration_ms";
ALTER TABLE "media"."objects" DROP COLUMN IF EXISTS "thumb_storage_key";
ALTER TABLE "media"."objects" ALTER COLUMN "height" SET NOT NULL;
ALTER TABLE "media"."objects" ALTER COLUMN "width" SET NOT NULL;
