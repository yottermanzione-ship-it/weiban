ALTER TABLE ai_runtime.proactive_plans
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN retry_reason text,
  ADD COLUMN retry_epoch text,
  ADD COLUMN retry_until timestamptz;
--> statement-breakpoint
ALTER TABLE ai_runtime.ecology_runs
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN retry_reason text,
  ADD COLUMN retry_epoch text,
  ADD COLUMN retry_until timestamptz,
  ADD COLUMN retry_kind text,
  ADD COLUMN retry_at timestamptz;
--> statement-breakpoint
CREATE INDEX ecology_retry_due_idx ON ai_runtime.ecology_runs(user_id,retry_at)
  WHERE retry_kind IS NOT NULL;
--> statement-breakpoint
CREATE INDEX ecology_retry_expiry_idx ON ai_runtime.ecology_runs(retry_until)
  WHERE retry_kind IS NOT NULL;
--> statement-breakpoint
CREATE INDEX proactive_retry_expiry_idx ON ai_runtime.proactive_plans(retry_until)
  WHERE retry_reason IS NOT NULL AND status='planned';
