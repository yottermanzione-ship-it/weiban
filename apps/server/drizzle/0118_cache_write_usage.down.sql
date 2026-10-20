-- 回滚 0118：去掉缓存写入用量列；价目表里的缓存写入价格行删掉（旧代码不认识这两个单位）。
DELETE FROM billing.price_items WHERE unit IN ('cache_write_5m_tokens_per_million', 'cache_write_1h_tokens_per_million');
ALTER TABLE model_access.usage_records DROP CONSTRAINT IF EXISTS usage_records_cache_write_nonnegative;
ALTER TABLE model_access.usage_records DROP COLUMN IF EXISTS cache_write_1h_tokens;
ALTER TABLE model_access.usage_records DROP COLUMN IF EXISTS cache_write_5m_tokens;
