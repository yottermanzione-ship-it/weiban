ALTER TABLE ai_runtime.chat_summary_states
  ADD COLUMN attempt_generation integer NOT NULL DEFAULT 0 CHECK (attempt_generation >= 0),
  ADD COLUMN retry_char_limit integer CHECK (retry_char_limit > 0),
  ADD COLUMN last_failure text;
ALTER TABLE ai_runtime.memory_states
  ADD COLUMN fact_wait_reason text,
  ADD COLUMN fact_generation integer NOT NULL DEFAULT 0 CHECK (fact_generation >= 0);
ALTER TABLE ai_runtime.group_memory_states ADD COLUMN wait_reason text;
ALTER TABLE ai_runtime.chat_summary_versions ADD COLUMN adopted_usage_id uuid;
CREATE TABLE ai_runtime.summary_refund_jobs (
  usage_record_id uuid PRIMARY KEY, user_id uuid NOT NULL, retry_after timestamptz NOT NULL
);
CREATE INDEX summary_refunds_due_idx ON ai_runtime.summary_refund_jobs(retry_after);
CREATE INDEX memory_funding_due_idx ON ai_runtime.memory_states(retry_after) WHERE fact_wait_reason='insufficient_balance';
CREATE INDEX group_memory_funding_due_idx ON ai_runtime.group_memory_states(retry_after) WHERE wait_reason='insufficient_balance';
CREATE INDEX chat_summary_funding_due_idx ON ai_runtime.chat_summary_states(retry_after) WHERE last_failure='insufficient_balance';

-- Identify an existing summary funding rejection only by its exact logical request and
-- reservation attempt. A future deadline alone is not evidence of insufficient balance.
UPDATE ai_runtime.chat_summary_states s SET last_failure=u.error_code,
  retry_after=CASE WHEN u.error_code='insufficient_balance' THEN least(s.retry_after,now())
    ELSE ((date_trunc('day',u.created_at AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai') END
FROM ai_runtime.memory_states m, model_access.generation_results g, model_access.usage_records u
WHERE m.id=s.parent_id AND g.user_id=m.user_id AND g.phase='complete'
  AND s.prepared_ciphertext IS NULL AND s.lease_id IS NULL AND u.created_at<=s.updated_at
  AND s.retry_after IS NOT NULL AND s.target_seq>s.covered_seq
  AND g.key_hash=encode(sha256(convert_to(m.user_id::text,'UTF8') || decode('00','hex') ||
    convert_to('chat-summary:'||s.id::text||':'||s.version||':'||s.attempts,'UTF8')),'hex')
  AND u.user_id=m.user_id AND u.conversation_id=m.conversation_id AND u.purpose='memory'
  AND u.idempotency_key='gateway:'||g.id::text||':attempt:0' AND u.status='failed'
  AND u.error_code IN ('insufficient_balance','budget_exceeded');
