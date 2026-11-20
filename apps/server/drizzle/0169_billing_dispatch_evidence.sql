ALTER TABLE model_access.usage_records
  ADD COLUMN request_price_limit jsonb,
  ADD COLUMN cancellation_reason text;
--> statement-breakpoint
ALTER TABLE model_access.generation_results ADD COLUMN replay_blocked boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE billing.foreground_waiters (
  id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES billing.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX foreground_waiters_account_idx ON billing.foreground_waiters(account_id,expires_at);
CREATE INDEX foreground_waiters_expiry_idx ON billing.foreground_waiters(expires_at);
