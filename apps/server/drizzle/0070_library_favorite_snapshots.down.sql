-- 0070 回滚
ALTER TABLE "library"."favorites" DROP COLUMN IF EXISTS "source_seq";
ALTER TABLE "library"."favorites" DROP COLUMN IF EXISTS "character_avatar_media_id_snapshot";
ALTER TABLE "library"."favorites" DROP COLUMN IF EXISTS "character_name_snapshot";
