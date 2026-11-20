DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ai_runtime.summary_refund_jobs) THEN
    RAISE EXCEPTION 'pending summary refunds must finish before rollback';
  END IF;
END $$;
ALTER TABLE ai_runtime.chat_summary_states DROP COLUMN last_failure, DROP COLUMN attempt_generation, DROP COLUMN retry_char_limit;
ALTER TABLE ai_runtime.memory_states DROP COLUMN fact_wait_reason, DROP COLUMN fact_generation;
ALTER TABLE ai_runtime.group_memory_states DROP COLUMN wait_reason;
ALTER TABLE ai_runtime.chat_summary_versions DROP COLUMN adopted_usage_id;
DROP TABLE ai_runtime.summary_refund_jobs;
