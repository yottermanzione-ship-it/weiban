-- 0047_media_usage_units.sql（T-071）：用量记录增加多媒体用量（语音字数 / 识别秒数 / 图片张数 / 搜索次数）。
ALTER TABLE "model_access"."usage_records" ADD COLUMN IF NOT EXISTS "media_units" jsonb;
