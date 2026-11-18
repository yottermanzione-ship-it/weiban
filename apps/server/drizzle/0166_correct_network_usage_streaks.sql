-- Reconcile only streaks fully explained by recorded interrupted network attempts.
-- Keep alerts, attempt history, usage, charges and routing settings intact.
LOCK TABLE model_access.model_routes IN SHARE ROW EXCLUSIVE MODE;
WITH candidates AS (
  SELECT r.model_key, r.upstream_id, r.upstream_model_id, r.usage_missing_streak,
         r.usage_missing_since, r.usage_missing_alerted_at, r.updated_at
  FROM model_access.model_routes r
  JOIN model_access.generation_attempts a ON a.model_key = r.model_key
    AND a.upstream_id = r.upstream_id AND a.upstream_model_id = r.upstream_model_id
    AND a.phase = 'finished'
    -- The recorder finishes the attempt just before incrementing the streak.
    AND a.finished_at >= r.usage_missing_since - interval '3 seconds'
  WHERE r.usage_missing_streak > 0
  GROUP BY r.model_key, r.upstream_id
  HAVING count(*) FILTER (WHERE a.usage_state = 'estimated' AND a.error_code = 'network_error') = r.usage_missing_streak
     AND count(*) FILTER (WHERE a.usage_state = 'reported'
       OR (a.usage_state = 'estimated' AND a.error_code IS DISTINCT FROM 'network_error')
       OR a.error_code = 'interrupted') = 0
), saved AS (
  INSERT INTO model_access.settings(key,value,updated_at)
  SELECT 'migration_0166_network_usage_streaks', jsonb_agg(to_jsonb(candidates)), now()
  FROM candidates HAVING count(*) > 0
  ON CONFLICT (key) DO NOTHING
  RETURNING value
)
UPDATE model_access.model_routes r
SET usage_missing_streak = 0, usage_missing_since = NULL, usage_missing_alerted_at = NULL
FROM saved, jsonb_to_recordset(saved.value) AS old(model_key text, upstream_id uuid)
WHERE r.model_key = old.model_key AND r.upstream_id = old.upstream_id;
