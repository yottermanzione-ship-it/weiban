DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ai_runtime.call_memory_jobs WHERE status='pending') OR EXISTS(SELECT 1 FROM ai_runtime.group_memory_states WHERE pending_count>0) THEN
  RAISE EXCEPTION 'conversation memory work pending; drain or back up before rollback';
 END IF;
END $$;
DROP TABLE ai_runtime.call_memory_jobs;
DROP TABLE ai_runtime.group_memory_states;
ALTER TABLE ai_runtime.memories DROP COLUMN origin;
