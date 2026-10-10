-- 0047_media_usage_units.down.sql
ALTER TABLE "model_access"."usage_records" DROP COLUMN IF EXISTS "media_units";
