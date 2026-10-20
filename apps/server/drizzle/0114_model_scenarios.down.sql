DELETE FROM model_access.settings WHERE key = 'model_uses';
ALTER TABLE model_access.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_scenarios_check;
ALTER TABLE model_access.model_catalog DROP COLUMN IF EXISTS scenarios;
