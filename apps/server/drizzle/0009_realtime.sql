CREATE SCHEMA "realtime";
--> statement-breakpoint
CREATE TABLE "realtime"."device_presence" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"conversation_id" uuid,
	"foreground" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realtime"."user_update_cursors" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"last_update_seq" bigint DEFAULT 0 NOT NULL,
	"trimmed_through" bigint DEFAULT 0 NOT NULL,
	"last_user_activity_at" timestamp with time zone,
	CONSTRAINT "cursor_range" CHECK ("realtime"."user_update_cursors"."trimmed_through" >= 0 AND "realtime"."user_update_cursors"."trimmed_through" <= "realtime"."user_update_cursors"."last_update_seq" AND "realtime"."user_update_cursors"."last_update_seq" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "realtime"."user_updates" (
	"user_id" uuid NOT NULL,
	"update_seq" bigint NOT NULL,
	"encrypted_payload" "bytea" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_updates_user_id_update_seq_pk" PRIMARY KEY("user_id","update_seq"),
	CONSTRAINT "update_seq_range" CHECK ("realtime"."user_updates"."update_seq" > 0 AND "realtime"."user_updates"."update_seq" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX "presence_user_idx" ON "realtime"."device_presence" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "updates_retention_idx" ON "realtime"."user_updates" USING btree ("occurred_at");