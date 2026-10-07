CREATE SCHEMA "push";
--> statement-breakpoint
CREATE TABLE "push"."admin_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"summary" text NOT NULL,
	"refs" jsonb,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"first_raised_at" timestamp with time zone NOT NULL,
	"last_raised_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	CONSTRAINT "push_alert_occurrences" CHECK ("push"."admin_alerts"."occurrences">0)
);
--> statement-breakpoint
CREATE TABLE "push"."deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"collapse_key" text NOT NULL,
	"payload_ciphertext" "bytea",
	"count" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"provider_message_id" text,
	"reason" text,
	CONSTRAINT "push_request_device_idx" UNIQUE("request_id","device_id"),
	CONSTRAINT "push_delivery_status" CHECK ("push"."deliveries"."status" IN ('queued','sending','delivered','cancelled','failed')),
	CONSTRAINT "push_delivery_counters" CHECK ("push"."deliveries"."count">0 AND "push"."deliveries"."attempts">=0 AND "push"."deliveries"."attempts"<=4)
);
--> statement-breakpoint
CREATE TABLE "push"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"credential_hash" text NOT NULL,
	"credential_ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_credential_idx" UNIQUE("credential_hash"),
	CONSTRAINT "push_device_kind" CHECK ("push"."devices"."kind" IN ('webpush','android'))
);
--> statement-breakpoint
CREATE TABLE "push"."requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"kind" text NOT NULL,
	"respects_do_not_disturb" boolean DEFAULT false NOT NULL,
	"model_context" jsonb,
	"dedupe_key" text NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"payload_ciphertext" "bytea",
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "push_event_user_idx" UNIQUE("user_id","event_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_open_alert_idx" ON "push"."admin_alerts" USING btree ("dedupe_key") WHERE "push"."admin_alerts"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_alert_recent_idx" ON "push"."admin_alerts" USING btree ("last_raised_at","id");--> statement-breakpoint
CREATE INDEX "push_delivery_due_idx" ON "push"."deliveries" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "push_delivery_collapse_idx" ON "push"."deliveries" USING btree ("device_id","collapse_key","created_at");--> statement-breakpoint
CREATE INDEX "push_device_session_idx" ON "push"."devices" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "push_request_dedupe_idx" ON "push"."requests" USING btree ("user_id","dedupe_key","created_at");--> statement-breakpoint
CREATE INDEX "push_request_expiry_idx" ON "push"."requests" USING btree ("expires_at");