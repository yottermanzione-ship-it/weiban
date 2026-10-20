-- 10-21 试用反馈第二轮 F2（契约 3.24）：去掉「图片识别」场景。
-- 图片随「文本聊天」（私密模式下随「私密模式」）发给同一个模型，后台要求这两类模型具备识图能力。
-- ① 迁移已有配置：用户 / 角色的图片识别选择删除（文本聊天模型自己识图）；
--    用户没配文本聊天、只配了图片识别时，把它转成文本聊天（该模型须已勾选可用于文本聊天）。
INSERT INTO model_access.scenario_selections (user_id, scenario, model_key, updated_at)
SELECT s.user_id, 'chat', s.model_key, now()
FROM model_access.scenario_selections s
JOIN model_access.model_catalog c ON c.model_key = s.model_key AND 'chat' = ANY(c.scenarios)
WHERE s.scenario = 'vision'
ON CONFLICT DO NOTHING;
DELETE FROM model_access.scenario_selections WHERE scenario = 'vision';
DELETE FROM model_access.character_scenario_overrides WHERE scenario = 'vision';
-- ② 模型的「可用于图片识别」勾选去掉；推荐模型里的 vision 去掉。
UPDATE model_access.model_catalog SET scenarios = array_remove(scenarios, 'vision') WHERE 'vision' = ANY(scenarios);
UPDATE model_access.settings
SET value = jsonb_set(value, '{recommended}', (value -> 'recommended') - 'vision'), updated_at = now()
WHERE key = 'model_uses' AND value ? 'recommended' AND (value -> 'recommended') ? 'vision';
-- ③ 约束不再允许 vision。
ALTER TABLE model_access.model_catalog DROP CONSTRAINT model_catalog_scenarios_check;
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_scenarios_check
  CHECK (scenarios <@ ARRAY['chat','voice_message','speech_recognition','voice_call','image_generation','private']::text[]);
ALTER TABLE model_access.scenario_selections DROP CONSTRAINT scenario_selections_scenario_check;
ALTER TABLE model_access.scenario_selections ADD CONSTRAINT scenario_selections_scenario_check
  CHECK (scenario IN ('chat','voice_message','speech_recognition','voice_call','image_generation','private'));
ALTER TABLE model_access.character_scenario_overrides DROP CONSTRAINT character_scenario_overrides_scenario_check;
ALTER TABLE model_access.character_scenario_overrides ADD CONSTRAINT character_scenario_overrides_scenario_check
  CHECK (scenario IN ('chat','voice_message','speech_recognition','voice_call','image_generation','private'));
