DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM characters.legacy_persona_overrides)
 OR EXISTS(SELECT 1 FROM characters.legacy_persona_sources)
 OR EXISTS(SELECT 1 FROM characters.legacy_persona_commands) THEN
  RAISE EXCEPTION 'legacy_persona_data_requires_forward_fix';
 END IF;
END $$;
DROP TABLE characters.legacy_persona_commands;
DROP TABLE characters.legacy_persona_sources;
DROP TABLE characters.legacy_persona_overrides;
