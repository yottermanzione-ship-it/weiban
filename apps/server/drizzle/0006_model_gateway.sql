CREATE TABLE "model_access"."generation_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"phase" text NOT NULL,
	"ciphertext" "bytea",
	"usage_record_id" uuid,
	"hold_id" uuid,
	"upstream_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "generation_results_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "generation_results_phase_check" CHECK ("model_access"."generation_results"."phase" in ('pending', 'result', 'complete'))
);
--> statement-breakpoint
CREATE INDEX "generation_results_expiry_idx" ON "model_access"."generation_results" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "generation_results_user_idx" ON "model_access"."generation_results" USING btree ("user_id");