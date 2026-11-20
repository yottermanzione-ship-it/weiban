ALTER TABLE model_access.generation_results DROP COLUMN replay_blocked;
--> statement-breakpoint
ALTER TABLE billing.accounts DROP COLUMN foreground_wait_until;
--> statement-breakpoint
ALTER TABLE model_access.usage_records DROP COLUMN cancellation_reason, DROP COLUMN request_price_limit;
