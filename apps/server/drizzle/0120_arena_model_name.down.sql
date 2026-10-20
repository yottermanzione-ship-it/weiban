-- 回滚 0120：去掉榜单对应名称与榜单快照。
DELETE FROM model_access.settings WHERE key = 'leaderboard_snapshot';
ALTER TABLE model_access.model_catalog DROP CONSTRAINT IF EXISTS model_catalog_arena_model_name_check;
ALTER TABLE model_access.model_catalog DROP COLUMN IF EXISTS arena_model_name;
