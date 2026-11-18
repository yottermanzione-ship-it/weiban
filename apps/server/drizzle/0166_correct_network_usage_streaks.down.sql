-- Restore only untouched routes without subsequent attempt evidence.
LOCK TABLE model_access.model_routes IN SHARE ROW EXCLUSIVE MODE;
WITH saved AS (
  DELETE FROM model_access.settings WHERE key = 'migration_0166_network_usage_streaks'
  RETURNING value,updated_at AS corrected_at
)
UPDATE model_access.model_routes r
SET usage_missing_streak = old.usage_missing_streak,
    usage_missing_since = old.usage_missing_since, usage_missing_alerted_at = old.usage_missing_alerted_at
FROM saved, jsonb_to_recordset(saved.value) AS old(
  model_key text, upstream_id uuid, upstream_model_id text, usage_missing_streak int,
  usage_missing_since timestamptz, usage_missing_alerted_at timestamptz, updated_at timestamptz)
WHERE r.model_key = old.model_key AND r.upstream_id = old.upstream_id AND r.upstream_model_id = old.upstream_model_id
  AND r.updated_at = old.updated_at AND r.usage_missing_streak = 0
  AND NOT EXISTS (
    SELECT 1 FROM model_access.generation_attempts a
    WHERE a.model_key = r.model_key AND a.upstream_id = r.upstream_id AND a.upstream_model_id = r.upstream_model_id
      AND (a.created_at >= saved.corrected_at OR a.finished_at >= saved.corrected_at)
  );
