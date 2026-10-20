-- 10-20 批 E3（契约 3.22）：用户按场景的模型配置 + 角色逐场景单独设置。
CREATE TABLE model_access.scenario_selections (
  user_id uuid NOT NULL,
  scenario text NOT NULL,
  model_key text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, scenario),
  CONSTRAINT scenario_selections_scenario_check CHECK (scenario IN ('chat','vision','voice_message','speech_recognition','voice_call','image_generation','private'))
);
CREATE INDEX scenario_selections_model_idx ON model_access.scenario_selections (model_key);
CREATE TABLE model_access.character_scenario_overrides (
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  scenario text NOT NULL,
  model_key text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, character_id, scenario),
  CONSTRAINT character_scenario_overrides_scenario_check CHECK (scenario IN ('chat','vision','voice_message','speech_recognition','voice_call','image_generation','private'))
);
CREATE INDEX character_scenario_overrides_character_idx ON model_access.character_scenario_overrides (character_id);

-- 老用户迁移：把现有选择 / 原平台默认写成场景配置，避免老号被首次引导拦住。
--   文本聊天、语音通话 = 原全局聊天模型，没选过 = 原平台默认聊天模型；私密模式 = 原成人模式模型；
--   图片识别 / 语音消息 / 语音识别 / 发照片 = 原平台默认（以前由平台默认提供）。
--   原「后台模型」不再单独存在（后台文字任务跟随文本聊天）。
WITH d AS (
  SELECT
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'chat' = ANY(default_for) ORDER BY model_key LIMIT 1) AS chat,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'vision' = ANY(default_for) ORDER BY model_key LIMIT 1) AS vision,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'speech_synthesis' = ANY(default_for) ORDER BY model_key LIMIT 1) AS tts,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'speech_recognition' = ANY(default_for) ORDER BY model_key LIMIT 1) AS asr,
    (SELECT model_key FROM model_access.model_catalog WHERE enabled AND 'image_generation' = ANY(default_for) ORDER BY model_key LIMIT 1) AS image
), b AS (
  SELECT u.id AS user_id, s.chat_model_key, s.adult_model_key
  FROM identity.users u LEFT JOIN model_access.selections s ON s.user_id = u.id
  WHERE u.status = 'active'
)
INSERT INTO model_access.scenario_selections (user_id, scenario, model_key, updated_at)
SELECT b.user_id, v.scenario, v.model_key, now()
FROM b CROSS JOIN d
CROSS JOIN LATERAL (VALUES
  ('chat', coalesce(b.chat_model_key, d.chat)),
  ('voice_call', coalesce(b.chat_model_key, d.chat)),
  ('private', b.adult_model_key),
  ('vision', d.vision),
  ('voice_message', d.tts),
  ('speech_recognition', d.asr),
  ('image_generation', d.image)
) AS v(scenario, model_key)
WHERE v.model_key IS NOT NULL
ON CONFLICT DO NOTHING;

-- 原「角色单独聊天模型」→ 该角色的文本聊天与语音通话（以前通话也用它）。
INSERT INTO model_access.character_scenario_overrides (user_id, character_id, scenario, model_key, updated_at)
SELECT o.user_id, o.character_id, v.scenario, o.chat_model_key, now()
FROM model_access.character_overrides o
CROSS JOIN (VALUES ('chat'), ('voice_call')) AS v(scenario)
ON CONFLICT DO NOTHING;
