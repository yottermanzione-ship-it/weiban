DROP TABLE ai_runtime.memories;
DROP TABLE ai_runtime.memory_states;
ALTER TABLE ai_runtime.companion_settings DROP CONSTRAINT companion_persona_fit;
ALTER TABLE ai_runtime.companion_settings DROP CONSTRAINT companion_mode;
ALTER TABLE ai_runtime.companion_settings DROP CONSTRAINT companion_frequency;
ALTER TABLE ai_runtime.companion_settings DROP COLUMN persona_fit, DROP COLUMN scenario_mode,
  DROP COLUMN proactive_messages, DROP COLUMN proactive_frequency,
  DROP COLUMN proactive_calls, DROP COLUMN daily_life;
