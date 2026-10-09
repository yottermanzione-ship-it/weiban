-- 0015 记忆向量检索 + 分层摘要（T-046）
-- 向量维度 256，对应统计嵌入（Phase 1）；神经模型升级时可通过新迁移修改维度。
-- 分层摘要新增 daily_summaries_ciphertext、monthly_summaries_ciphertext 两列，格式与 summary_ciphertext 同为 bytea（加密JSON）。

-- 1. 启用 pgvector 扩展（如已安装则跳过）
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. memories 表增加向量列（明文存储，见 ADR-0020）
ALTER TABLE ai_runtime.memories
  ADD COLUMN IF NOT EXISTS embedding vector(256);

-- 3. 为向量列建 HNSW 近似近邻索引（余弦距离），scope 过滤依赖 WHERE 子句
CREATE INDEX IF NOT EXISTS memory_embedding_hnsw_idx
  ON ai_runtime.memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. memory_states 增加日/月摘要列
ALTER TABLE ai_runtime.memory_states
  ADD COLUMN IF NOT EXISTS daily_summaries_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS monthly_summaries_ciphertext bytea,
  ADD COLUMN IF NOT EXISTS last_daily_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_monthly_at timestamp with time zone;
