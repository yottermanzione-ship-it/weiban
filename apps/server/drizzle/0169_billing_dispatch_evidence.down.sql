ALTER TABLE model_access.generation_results DROP COLUMN replay_blocked;
--> statement-breakpoint
DROP TABLE billing.foreground_waiters;
--> statement-breakpoint
ALTER TABLE model_access.usage_records DROP COLUMN cancellation_reason, DROP COLUMN request_price_limit;
