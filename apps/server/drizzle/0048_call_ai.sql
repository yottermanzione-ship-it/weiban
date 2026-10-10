-- 0048_call_ai.sql（T-072）：P-45「不方便」静默状态、主动来电记录（MED-07、P-10）。
CREATE TABLE IF NOT EXISTS "ai_runtime"."user_quiet_states" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"inconvenient_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_runtime"."call_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"reason" text NOT NULL,
	"source_ref" text NOT NULL,
	"call_id" uuid,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "call_attempt_source_idx" UNIQUE("user_id","source_ref")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_attempt_user_created_idx" ON "ai_runtime"."call_attempts" USING btree ("user_id","created_at");
