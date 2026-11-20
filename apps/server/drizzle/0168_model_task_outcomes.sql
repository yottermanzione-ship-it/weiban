ALTER TABLE model_access.usage_records ADD COLUMN task_key uuid;
CREATE TABLE model_access.task_outcomes (
  task_key uuid PRIMARY KEY, user_id uuid NOT NULL, purpose text NOT NULL,
  state text NOT NULL CHECK (state IN ('delivered','displayed','saved','filtered','deferred','blocked','cancelled','failed')),
  reason text CHECK (reason ~ '^[a-z][a-z0-9_]{0,79}$'), usage_record_id uuid, retry_at timestamptz,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
-- 每个历史调用只按既有生成外键或完整结构化幂等键归属。
UPDATE model_access.usage_records u SET task_key=a.generation_id
FROM model_access.generation_attempts a WHERE a.usage_record_id=u.id AND a.user_id=u.user_id;
UPDATE model_access.usage_records u SET task_key=split_part(u.idempotency_key,':',2)::uuid
WHERE task_key IS NULL AND idempotency_key ~ '^gateway:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:attempt:[0-9]+$';
CREATE INDEX usage_records_task_idx ON model_access.usage_records(task_key,created_at,id);
CREATE INDEX task_outcomes_created_idx ON model_access.task_outcomes(created_at,task_key);
CREATE INDEX task_outcomes_user_idx ON model_access.task_outcomes(user_id);
