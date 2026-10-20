-- 回滚 0117：已软删的模型行直接删掉（回滚后旧代码不认识它们；历史调用记录退回只显示模型键）。
DELETE FROM model_access.model_catalog WHERE deleted_at IS NOT NULL;
DROP INDEX IF EXISTS model_access.model_catalog_original_key_idx;
ALTER TABLE model_access.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_deleted_check;
ALTER TABLE model_access.model_catalog DROP COLUMN IF EXISTS original_model_key;
ALTER TABLE model_access.model_catalog DROP COLUMN IF EXISTS deleted_at;
