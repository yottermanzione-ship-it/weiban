CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TABLE "identity"."deletion_progress" (
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"deleted_rows" integer NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deletion_progress_user_id_module_pk" PRIMARY KEY("user_id","module")
);
--> statement-breakpoint
CREATE TABLE "identity"."invites" (
	"code" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE "identity"."login_throttle" (
	"key" "bytea" PRIMARY KEY NOT NULL,
	"failures" integer NOT NULL,
	"last_failed_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"proactive_messages_enabled" boolean NOT NULL,
	"proactive_calls_enabled" boolean NOT NULL,
	"push_sound_enabled" boolean NOT NULL,
	"push_show_content" boolean NOT NULL,
	"dnd_enabled" boolean NOT NULL,
	"dnd_start" text NOT NULL,
	"dnd_end" text NOT NULL,
	"allow_character_group_invites" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nickname" text,
	"avatar_media_id" uuid,
	"birthday" date,
	"gender" text NOT NULL,
	"city" text,
	"about" text,
	"time_zone" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"device" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_kind_check" CHECK ("identity"."sessions"."kind" in ('app', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	CONSTRAINT "users_role_check" CHECK ("identity"."users"."role" in ('user', 'admin')),
	CONSTRAINT "users_status_check" CHECK ("identity"."users"."status" in ('active', 'deleting'))
);
--> statement-breakpoint
ALTER TABLE "identity"."deletion_progress" ADD CONSTRAINT "deletion_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "identity"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_idempotency_key_key" ON "identity"."invites" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "invites_created_at_idx" ON "identity"."invites" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "identity"."sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "identity"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "identity"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_key" ON "identity"."users" USING btree (lower("username"));