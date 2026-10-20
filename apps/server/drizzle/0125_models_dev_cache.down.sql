-- 回滚 0125：删除 models.dev 缓存与汇率设置。
DROP TABLE IF EXISTS model_access.models_dev_snapshot;
DELETE FROM model_access.settings WHERE key = 'models_dev_settings';
