-- 10-21 试用反馈第三轮 G3-2（契约 3.26）：上游没报用量时按本地估算计费、标记「估算」，不再暂停线路。
-- ① 解除以前因「用量未知」被系统暂停的线路（暂停时系统把线路改成停用并在计费上限里写了 pauseReason）；
UPDATE model_access.model_routes
SET enabled = true, billing_bounds = billing_bounds - 'pauseReason', updated_at = now()
WHERE billing_bounds ->> 'pauseReason' = 'usage_unknown';
UPDATE model_access.model_catalog
SET billing_bounds = billing_bounds - 'pauseReason', updated_at = now()
WHERE billing_bounds ->> 'pauseReason' = 'usage_unknown';
-- ② 线路连续缺用量的计数（后台提示用；上游重新报用量就清零，达到阈值只提示一次，不停用）。
ALTER TABLE model_access.model_routes
  ADD COLUMN usage_missing_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN usage_missing_since timestamptz,
  ADD COLUMN usage_missing_alerted_at timestamptz;
ALTER TABLE model_access.model_routes ADD CONSTRAINT model_routes_usage_missing_streak_check
  CHECK (usage_missing_streak >= 0);
