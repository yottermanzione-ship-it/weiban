DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM ai_runtime.legacy_group_memories)
 OR EXISTS(SELECT 1 FROM ai_runtime.legacy_group_memory_sources)
 OR EXISTS(SELECT 1 FROM ai_runtime.legacy_group_memory_exclusions) THEN
  RAISE EXCEPTION 'legacy_group_memory_data_requires_forward_fix';
 END IF;
END $$;
DROP TABLE ai_runtime.legacy_group_memory_exclusions;
DROP TABLE ai_runtime.legacy_group_memories;
DROP TABLE ai_runtime.legacy_group_memory_sources;
