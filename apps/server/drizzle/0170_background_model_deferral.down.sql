-- Old schedulers cannot validate a resumed relationship or deduplicate a second dispatch.
WITH owners AS (
  SELECT user_id, 'proactive:' || id::text AS source_key FROM ai_runtime.proactive_plans
   WHERE retry_reason IS NOT NULL AND status IN ('planned','generating')
  UNION ALL
  SELECT user_id, CASE WHEN retry_kind IN ('wake','running_wake') THEN 'eco:' || id::text || ':jev' ELSE 'eco:murmur:' || id::text END
   FROM ai_runtime.ecology_runs WHERE retry_kind IS NOT NULL
), hashes AS (
  SELECT substring(sha256(convert_to('weiban:model-task:v1:'||user_id::text||':'||source_key,'UTF8')) FROM 1 FOR 16) b FROM owners
)
UPDATE model_access.task_outcomes SET state='cancelled',reason='migration_rollback',retry_at=NULL,updated_at=now()
 WHERE state='deferred' AND task_key IN (
   SELECT encode(set_byte(set_byte(b,6,(get_byte(b,6)&15)|128),8,(get_byte(b,8)&63)|128),'hex')::uuid FROM hashes
 );
UPDATE ai_runtime.proactive_plans SET status='dropped',outcome='migration_rollback'
 WHERE retry_reason IS NOT NULL AND status='planned';
DROP INDEX IF EXISTS ai_runtime.ecology_retry_due_idx;
DROP INDEX IF EXISTS ai_runtime.proactive_retry_expiry_idx;
DROP INDEX IF EXISTS ai_runtime.ecology_retry_expiry_idx;
ALTER TABLE ai_runtime.ecology_runs DROP COLUMN retry_kind, DROP COLUMN retry_at,
  DROP COLUMN retry_count,DROP COLUMN retry_reason,DROP COLUMN retry_epoch,DROP COLUMN retry_until;
ALTER TABLE ai_runtime.proactive_plans DROP COLUMN retry_count,DROP COLUMN retry_reason,DROP COLUMN retry_epoch,DROP COLUMN retry_until;
