ALTER TABLE model_access.usage_records
  ADD COLUMN request_price_limit jsonb,
  ADD COLUMN cancellation_reason text;
--> statement-breakpoint
ALTER TABLE model_access.generation_results ADD COLUMN replay_blocked boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE billing.accounts ADD COLUMN foreground_wait_until timestamptz;
