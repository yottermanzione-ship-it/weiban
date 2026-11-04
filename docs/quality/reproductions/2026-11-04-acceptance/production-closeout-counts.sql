-- 收尾发布前后只读计数：不输出用户内容、账号名、单项价格或凭据。
-- 旧验收脚本保留原口径；本文件按已实现的整数向上取整规则核对。
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT count(*) AS alias_cleanup_migration_applied
FROM public.schema_migrations WHERE tag = '0159_anonymize_alias_audits';
SELECT count(*) AS alias_events_with_old_names
FROM platform.audit_log
WHERE module = 'identity' AND action = 'alias.updated'
  AND details ?| ARRAY['previous', 'username'];
SELECT count(*) AS active_price_versions
FROM billing.price_versions WHERE status = 'active';
SELECT count(*) AS all_active_price_items,
  count(*) FILTER (
    WHERE p.price_micros <> ceil(p.cost_micros::numeric * 13 / 10)
  ) AS all_price_mismatches
FROM billing.price_items p
JOIN billing.price_versions v ON v.id = p.price_version_id
WHERE v.status = 'active';
WITH prices AS (
  SELECT p.model_key, p.price_micros,
    ceil(p.cost_micros::numeric * 13 / 10) AS required
  FROM billing.price_items p
  JOIN billing.price_versions v ON v.id = p.price_version_id
  JOIN model_access.model_catalog m ON m.model_key = p.model_key
  WHERE v.status = 'active' AND m.enabled AND m.deleted_at IS NULL
)
SELECT count(*) AS enabled_price_items, count(DISTINCT model_key) AS enabled_priced_models,
  count(*) FILTER (WHERE price_micros <> required) AS mismatching_items,
  count(DISTINCT model_key) FILTER (WHERE price_micros <> required) AS mismatching_models,
  count(*) FILTER (WHERE price_micros > required) AS above_items,
  count(*) FILTER (WHERE price_micros < required) AS below_items
FROM prices;
SELECT count(*) AS waiting_database_locks FROM pg_locks WHERE NOT granted;
ROLLBACK;
