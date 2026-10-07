CREATE SCHEMA "ai_runtime";
--> statement-breakpoint
CREATE TABLE "ai_runtime"."companion_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid,
	"instant_reply" boolean NOT NULL,
	"split_bubbles" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "companion_user_character_idx" UNIQUE NULLS NOT DISTINCT("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."reply_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_id" uuid NOT NULL,
	"trigger_seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"lease_id" uuid,
	"lease_until" timestamp with time zone,
	"input_ciphertext" "bytea",
	"result_ciphertext" "bytea",
	"next_bubble" integer DEFAULT 0 NOT NULL,
	"retry_epoch" integer DEFAULT 0 NOT NULL,
	"failure" text,
	"care_until" timestamp with time zone,
	CONSTRAINT "reply_trigger_idx" UNIQUE("user_id","trigger_id"),
	CONSTRAINT "reply_plan_status" CHECK ("ai_runtime"."reply_plans"."status" IN ('queued','generating','waiting','sending','done','cancelled')),
	CONSTRAINT "reply_plan_kind" CHECK ("ai_runtime"."reply_plans"."kind" IN ('message','greeting')),
	CONSTRAINT "reply_plan_counters" CHECK ("ai_runtime"."reply_plans"."trigger_seq" >= 0 AND "ai_runtime"."reply_plans"."trigger_seq" <= 9007199254740991 AND "ai_runtime"."reply_plans"."next_bubble" >= 0 AND "ai_runtime"."reply_plans"."next_bubble" <= 4 AND "ai_runtime"."reply_plans"."retry_epoch" >= 0)
);
--> statement-breakpoint
CREATE INDEX "reply_due_idx" ON "ai_runtime"."reply_plans" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "reply_conversation_idx" ON "ai_runtime"."reply_plans" USING btree ("conversation_id","trigger_seq");