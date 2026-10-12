-- 0040_media_l5.sql
-- T-069 media 完整版（D-L5-01）：缩略图、语音时长、转写、内容摘要、生命周期。
-- statement-breakpoint
ALTER TABLE "media"."objects" ALTER COLUMN "width" DROP NOT NULL;
-- statement-breakpoint
ALTER TABLE "media"."objects" ALTER COLUMN "height" DROP NOT NULL;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "thumb_storage_key" text;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD CONSTRAINT "objects_thumb_storage_key_unique" UNIQUE ("thumb_storage_key");
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "duration_ms" integer;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "transcript_status" text;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "transcript_ciphertext" bytea;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "content_hash" text;
-- statement-breakpoint
ALTER TABLE "media"."objects" ADD COLUMN "expires_at" timestamptz;
-- statement-breakpoint
CREATE INDEX "objects_expires_idx" ON "media"."objects" USING btree ("expires_at");
