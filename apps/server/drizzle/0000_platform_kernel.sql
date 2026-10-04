CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TABLE "platform"."audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"target_type" text,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "platform"."event_inbox" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_inbox_consumer_event_id_pk" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"producer" text NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dispatched_at" timestamp with time zone,
	"dead_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform"."user_data_keys" (
	"owner" text PRIMARY KEY NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"kek_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "platform"."audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "platform"."audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "platform"."outbox" USING btree ("next_attempt_at") WHERE "platform"."outbox"."dispatched_at" is null and "platform"."outbox"."dead_at" is null;