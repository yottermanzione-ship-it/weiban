-- 0046_companion_voice.sql（T-071）：陪伴设置增加该角色的音色（CompanionSettings.voiceId，MED-03 第 1 条）。
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN IF NOT EXISTS "voice_id" uuid;
