ALTER TABLE ai_runtime.companion_settings
  ADD COLUMN memory_mode text NOT NULL DEFAULT 'model_window'
    CONSTRAINT companion_memory_mode CHECK (memory_mode IN ('model_window','recent_summary'));
ALTER TABLE ai_runtime.chat_summary_states
  ADD COLUMN memory_mode text NOT NULL DEFAULT 'model_window'
    CONSTRAINT chat_summary_memory_mode CHECK (memory_mode IN ('model_window','recent_summary')),
  DROP CONSTRAINT chat_summary_parent_scope_idx,
  ADD CONSTRAINT chat_summary_parent_scope_idx UNIQUE(parent_id,scope,memory_mode);
