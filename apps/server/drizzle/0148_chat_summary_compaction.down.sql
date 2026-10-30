DROP TABLE ai_runtime.chat_summary_versions;
DROP TABLE ai_runtime.chat_summary_states;
ALTER TABLE ai_runtime.memory_states DROP COLUMN fact_attempts, DROP COLUMN fact_trigger_seq;
