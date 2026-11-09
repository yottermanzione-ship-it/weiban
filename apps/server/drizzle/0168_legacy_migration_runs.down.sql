DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform.legacy_migration_runs)
 OR EXISTS(SELECT 1 FROM platform.legacy_migration_units)
 OR EXISTS(SELECT 1 FROM platform.legacy_migration_events)
 OR EXISTS(SELECT 1 FROM platform.legacy_migration_evidence)
 OR EXISTS(SELECT 1 FROM platform.legacy_migration_attempts) THEN
  RAISE EXCEPTION 'legacy_migration_ledger_requires_forward_fix';
 END IF;
END $$;
DROP TABLE platform.legacy_migration_attempts;
DROP TABLE platform.legacy_migration_evidence;
DROP TABLE platform.legacy_migration_events;
DROP TABLE platform.legacy_migration_units;
DROP TABLE platform.legacy_migration_runs;
DROP TABLE platform.legacy_migration_target_identity;
