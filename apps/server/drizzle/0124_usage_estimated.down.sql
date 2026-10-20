-- 回滚 0124：去掉缺用量计数。被 ① 解除暂停的线路不会重新暂停（暂停标记已删除，无法还原）。
ALTER TABLE model_access.model_routes DROP CONSTRAINT IF EXISTS model_routes_usage_missing_streak_check;
ALTER TABLE model_access.model_routes
  DROP COLUMN IF EXISTS usage_missing_streak,
  DROP COLUMN IF EXISTS usage_missing_since,
  DROP COLUMN IF EXISTS usage_missing_alerted_at;
