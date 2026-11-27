DELETE FROM ai_runtime.chat_summary_states WHERE memory_mode='recent_summary';
ALTER TABLE ai_runtime.chat_summary_states
  DROP CONSTRAINT chat_summary_parent_scope_idx,
  DROP COLUMN memory_mode,
  ADD CONSTRAINT chat_summary_parent_scope_idx UNIQUE(parent_id,scope);
ALTER TABLE ai_runtime.companion_settings DROP COLUMN memory_mode;
