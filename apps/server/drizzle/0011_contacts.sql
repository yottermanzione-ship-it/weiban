CREATE SCHEMA "contacts";
--> statement-breakpoint
CREATE TABLE "contacts"."contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" text NOT NULL,
	"request_id" uuid NOT NULL,
	"acceptance_mode" text NOT NULL,
	"accept_after" timestamp with time zone NOT NULL,
	"remark" text,
	"custom_avatar_media_id" uuid,
	"address_as" text,
	"known_since" date NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"conversation_id" uuid,
	"relationship_type" text NOT NULL,
	"greeting_ciphertext" "bytea",
	"referrer_character_id" uuid,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	CONSTRAINT "contact_status" CHECK ("contacts"."contacts"."status" IN ('pending','active','deleted')),
	CONSTRAINT "contact_acceptance_mode" CHECK ("contacts"."contacts"."acceptance_mode" IN ('new','restored','fresh_after_delete')),
	CONSTRAINT "contact_deletion_state" CHECK (("contacts"."contacts"."status" = 'deleted' AND "contacts"."contacts"."deleted_at" IS NOT NULL AND "contacts"."contacts"."purge_after" IS NOT NULL) OR ("contacts"."contacts"."status" <> 'deleted' AND "contacts"."contacts"."deleted_at" IS NULL AND "contacts"."contacts"."purge_after" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_user_character_idx" ON "contacts"."contacts" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "contact_user_status_idx" ON "contacts"."contacts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "contact_purge_idx" ON "contacts"."contacts" USING btree ("purge_after");