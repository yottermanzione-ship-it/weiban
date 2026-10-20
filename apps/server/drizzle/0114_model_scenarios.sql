-- 10-20 批 E3（契约 3.22）：模型按场景配置。
-- ① 模型可用于哪些场景（后台勾选）。按现有能力 / 计费上限 / 平台默认回填：
--    语音合成上限、曾是默认语音合成或被音色引用 → 语音消息；语音识别、图片生成同理；
--    其余文本模型 → 文本聊天、语音通话、私密模式；有识图能力 → 图片识别。
ALTER TABLE model_access.model_catalog ADD COLUMN scenarios text[] NOT NULL DEFAULT '{}';
UPDATE model_access.model_catalog c SET scenarios = ARRAY(
  SELECT DISTINCT s FROM unnest(ARRAY[
    CASE WHEN c.billing_bounds ? 'tts' OR 'speech_synthesis' = ANY(c.default_for)
           OR EXISTS (SELECT 1 FROM media.voices v WHERE v.model_key = c.model_key)
         THEN 'voice_message' END,
    CASE WHEN c.billing_bounds ? 'asr' OR 'speech_recognition' = ANY(c.default_for) THEN 'speech_recognition' END,
    CASE WHEN c.billing_bounds ? 'image' OR 'image_generation' = ANY(c.default_for) THEN 'image_generation' END,
    CASE WHEN t.is_text THEN 'chat' END,
    CASE WHEN t.is_text THEN 'voice_call' END,
    CASE WHEN t.is_text THEN 'private' END,
    CASE WHEN t.is_text AND 'vision' = ANY(c.capabilities) THEN 'vision' END
  ]) AS s WHERE s IS NOT NULL
)
FROM (
  SELECT model_key,
         (billing_bounds IS NULL OR billing_bounds ? 'text')
         AND NOT (default_for && ARRAY['speech_synthesis','speech_recognition','image_generation','web_search','planner']::text[])
         AS is_text
  FROM model_access.model_catalog
) t
WHERE t.model_key = c.model_key;
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_scenarios_check
  CHECK (scenarios <@ ARRAY['chat','vision','voice_message','speech_recognition','voice_call','image_generation','private']::text[]);

-- ② 场景推荐模型 + 平台内部模型（取代 default_for；default_for 列保留只为回滚，不再读写）。
WITH d AS (
  SELECT
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'chat' = ANY(default_for) ORDER BY model_key LIMIT 1) AS chat,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'vision' = ANY(default_for) ORDER BY model_key LIMIT 1) AS vision,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'speech_synthesis' = ANY(default_for) ORDER BY model_key LIMIT 1) AS tts,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'speech_recognition' = ANY(default_for) ORDER BY model_key LIMIT 1) AS asr,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'image_generation' = ANY(default_for) ORDER BY model_key LIMIT 1) AS image,
    (SELECT model_key FROM model_access.model_catalog
      WHERE enabled AND default_for && ARRAY['background','chat']::text[] AND NOT ('adult_content' = ANY(capabilities))
      ORDER BY ('background' = ANY(default_for)) DESC, model_key LIMIT 1) AS platform,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'planner' = ANY(default_for) ORDER BY model_key LIMIT 1) AS planner,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'adult_check' = ANY(default_for) ORDER BY model_key LIMIT 1) AS adult_check,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'web_search' = ANY(default_for) ORDER BY model_key LIMIT 1) AS web_search
)
INSERT INTO model_access.settings (key, value, updated_at)
SELECT 'model_uses', jsonb_build_object(
  'recommended', jsonb_strip_nulls(jsonb_build_object(
    'chat', d.chat, 'voice_call', d.chat, 'vision', d.vision,
    'voice_message', d.tts, 'speech_recognition', d.asr, 'image_generation', d.image
  )),
  'internal', jsonb_strip_nulls(jsonb_build_object(
    'safety', d.platform, 'small_v', d.platform, 'platform_content', d.platform,
    'planner', d.planner, 'adult_check', d.adult_check, 'web_search', d.web_search
  ))
), now()
FROM d
ON CONFLICT (key) DO NOTHING;
