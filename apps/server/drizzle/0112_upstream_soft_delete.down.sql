-- 回滚前先物理删除已软删的上游（它们的密钥已清空，不能再用）。
DELETE FROM model_access.upstreams WHERE deleted_at IS NOT NULL;
ALTER TABLE model_access.upstreams DROP COLUMN IF EXISTS deleted_at;
