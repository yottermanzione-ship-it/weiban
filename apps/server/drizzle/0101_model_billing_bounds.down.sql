DROP TABLE model_access.platform_purpose_limits;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM model_access.usage_records WHERE uncertain_cost_micros > 0) THEN RAISE EXCEPTION '存在未核成本风险，拒绝丢弃风险快照'; END IF; END $$;
ALTER TABLE model_access.usage_records DROP COLUMN cost_known, DROP COLUMN uncertain_cost_micros;
DROP TABLE model_access.generation_attempts;
ALTER TABLE model_access.model_routes DROP COLUMN billing_bounds;
ALTER TABLE model_access.model_catalog DROP COLUMN billing_bounds;
