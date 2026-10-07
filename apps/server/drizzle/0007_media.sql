CREATE SCHEMA "media";
--> statement-breakpoint
CREATE TABLE "media"."objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"purpose" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"storage_key" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "objects_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE INDEX "objects_owner_idx" ON "media"."objects" USING btree ("owner_id");