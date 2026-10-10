-- 0046_companion_voice.down.sql
ALTER TABLE "ai_runtime"."companion_settings" DROP COLUMN IF EXISTS "voice_id";
