CREATE SCHEMA "health";
--> statement-breakpoint
CREATE TABLE "health"."period_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entry_kind" CHECK ("health"."period_entries"."kind" IN ('cycle','day_log'))
);
--> statement-breakpoint
CREATE TABLE "health"."period_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"payload" "bytea" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "health"."grants" (
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "grants_user_character_pk" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN "labels" text[];
--> statement-breakpoint
CREATE INDEX "entries_user_idx" ON "health"."period_entries" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "grants_user_idx" ON "health"."grants" USING btree ("user_id");
