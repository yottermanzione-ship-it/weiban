-- 批 V：只读核对旧站音色在新站的落地情况（不改任何数据）。在新服务器上由总负责人执行：
--   docker exec -i weiban-prod-postgres-1 psql -U weiban -d weiban -v ON_ERROR_STOP=1 < verify-legacy-voices.sql
-- 参照（docs/handoffs/2026-10-24-migration-execution.md）：旧 character_voice_bindings 753 条 = 千问 TTS 351 + 实时 Plus 228 + Omni 174；
-- 新站应有 351 个千问 TTS 音色 + 137 个 MiMo 克隆、677 个角色都有默认音色；音色风格偏好 56 条中 55 条有效（12 个 vivid 用户补建 MiMo 音色）。
-- 实时 / Omni 的 402 条绑定当时按 realtime_only 跳过，批 V 用 import-legacy-realtime-voices 迁入（只迁 8d1b5e3b 账号下的）。
BEGIN READ ONLY;

\echo '1) 音色库：按模型统计（期望 qwen-audio-3.0-tts-plus ≈ 351、xiaomi/mimo-v2.5-tts-voiceclone ≈ 137+12）'
SELECT model_key, count(*) AS voices, count(*) FILTER (WHERE enabled) AS enabled
  FROM media.voices GROUP BY model_key ORDER BY voices DESC;

\echo '2) 角色默认音色（期望 677 个旧卡角色都有；按音色模型分布）'
SELECT v.model_key, count(*) AS characters
  FROM characters.default_voices d JOIN media.voices v ON v.id = d.voice_id
 GROUP BY v.model_key ORDER BY characters DESC;
SELECT count(*) AS default_voice_rows,
       count(*) FILTER (WHERE v.id IS NULL) AS dangling_voice,
       count(*) FILTER (WHERE v.enabled = false) AS disabled_voice
  FROM characters.default_voices d LEFT JOIN media.voices v ON v.id = d.voice_id;

\echo '3) 用户为角色指定的音色（含 12 个 vivid 用户的 MiMo 参考音色）'
SELECT v.model_key, count(*) AS settings
  FROM ai_runtime.companion_settings s JOIN media.voices v ON v.id = s.voice_id
 WHERE s.voice_id IS NOT NULL GROUP BY v.model_key ORDER BY settings DESC;
SELECT count(*) FILTER (WHERE s.voice_id IS NOT NULL AND v.id IS NULL) AS dangling_user_voice
  FROM ai_runtime.companion_settings s LEFT JOIN media.voices v ON v.id = s.voice_id;

\echo '4) 实时通话音色（批 V 0145；迁入后期望 Plus 行数 = 8d1b5e3b 账号下 ready 的绑定数）'
SELECT model_key, source, count(*) AS bindings
  FROM model_access.realtime_voice_bindings GROUP BY model_key, source ORDER BY model_key, source;
SELECT value AS realtime_default_voices
  FROM model_access.settings WHERE key = 'realtime_call_voices';

ROLLBACK;
