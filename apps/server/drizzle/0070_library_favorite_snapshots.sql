-- 0070（契约 3.1，积压 ㉔㉘）：收藏的角色名字 / 头像快照与原消息 seq（均可空，3.1 之前的收藏不带）。
ALTER TABLE "library"."favorites" ADD COLUMN IF NOT EXISTS "character_name_snapshot" text;
ALTER TABLE "library"."favorites" ADD COLUMN IF NOT EXISTS "character_avatar_media_id_snapshot" uuid;
ALTER TABLE "library"."favorites" ADD COLUMN IF NOT EXISTS "source_seq" integer;
