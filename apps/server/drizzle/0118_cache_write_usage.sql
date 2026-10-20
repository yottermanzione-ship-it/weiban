-- 10-21 试用反馈第二轮 F2（契约 3.24）：缓存写入计价。
-- Anthropic 原生协议会报告缓存写入 token（5 分钟 / 1 小时两档），按「缓存写入」价计（没定价按普通输入价）。
-- 用量记录多两列（副本，权威仍是 billing 流水）；价目表单位 cache_write_5m / 1h_tokens_per_million 不需要改表（unit 是文本）。
ALTER TABLE model_access.usage_records ADD COLUMN cache_write_5m_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE model_access.usage_records ADD COLUMN cache_write_1h_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE model_access.usage_records ADD CONSTRAINT usage_records_cache_write_nonnegative
  CHECK (cache_write_5m_tokens >= 0 AND cache_write_1h_tokens >= 0);
