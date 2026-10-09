-- 回滚 0015 记忆向量检索 + 分层摘要
DROP INDEX IF EXISTS ai_runtime.memory_embedding_hnsw_idx;
ALTER TABLE ai_runtime.memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE ai_runtime.memory_states
  DROP COLUMN IF EXISTS daily_summaries_ciphertext,
  DROP COLUMN IF EXISTS monthly_summaries_ciphertext,
  DROP COLUMN IF EXISTS last_daily_at,
  DROP COLUMN IF EXISTS last_monthly_at;
