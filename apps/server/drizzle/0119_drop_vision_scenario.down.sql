-- 回滚 0119：约束恢复允许 vision；已删除的图片识别配置不恢复（回滚后图片识别场景为未配置，
-- 文本聊天模型自己能识图时照常可用）；能识图的文本模型重新勾上图片识别。
ALTER TABLE model_access.model_catalog DROP CONSTRAINT model_catalog_scenarios_check;
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_scenarios_check
  CHECK (scenarios <@ ARRAY['chat','vision','voice_message','speech_recognition','voice_call','image_generation','private']::text[]);
ALTER TABLE model_access.scenario_selections DROP CONSTRAINT scenario_selections_scenario_check;
ALTER TABLE model_access.scenario_selections ADD CONSTRAINT scenario_selections_scenario_check
  CHECK (scenario IN ('chat','vision','voice_message','speech_recognition','voice_call','image_generation','private'));
ALTER TABLE model_access.character_scenario_overrides DROP CONSTRAINT character_scenario_overrides_scenario_check;
ALTER TABLE model_access.character_scenario_overrides ADD CONSTRAINT character_scenario_overrides_scenario_check
  CHECK (scenario IN ('chat','vision','voice_message','speech_recognition','voice_call','image_generation','private'));
UPDATE model_access.model_catalog SET scenarios = array_append(scenarios, 'vision')
WHERE 'chat' = ANY(scenarios) AND 'vision' = ANY(capabilities) AND NOT ('vision' = ANY(scenarios));
