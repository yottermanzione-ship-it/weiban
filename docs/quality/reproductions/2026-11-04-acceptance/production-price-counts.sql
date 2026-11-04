-- 生产只读聚合：只输出数量，不输出单价、账户、用户内容或凭据。
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT count(*) AS active_versions FROM billing.price_versions WHERE status = 'active';
WITH prices AS (
  SELECT p.model_key, p.unit, p.price_micros, round(p.cost_micros::numeric * 1.3) AS required
  FROM billing.price_items p
  JOIN billing.price_versions v ON v.id = p.price_version_id
  JOIN model_access.model_catalog m ON m.model_key = p.model_key
  WHERE v.status = 'active' AND m.enabled AND m.deleted_at IS NULL
)
SELECT count(*) AS rows, count(DISTINCT model_key) AS models,
  count(*) FILTER (WHERE price_micros <> required) AS mismatching_rows,
  count(DISTINCT model_key) FILTER (WHERE price_micros <> required) AS mismatching_models,
  count(*) FILTER (WHERE price_micros > required) AS above_rows,
  count(*) FILTER (WHERE price_micros < required) AS below_rows
FROM prices;
ROLLBACK;
