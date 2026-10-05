CREATE SCHEMA "model_access";
--> statement-breakpoint
CREATE TABLE "model_access"."character_overrides" (
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"chat_model_key" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "character_overrides_user_id_character_id_pk" PRIMARY KEY("user_id","character_id")
);
--> statement-breakpoint
CREATE TABLE "model_access"."model_catalog" (
	"model_key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"vendor_name" text NOT NULL,
	"upstream_id" uuid NOT NULL,
	"upstream_model_id" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"tags" text[] NOT NULL,
	"leaderboard_rank" integer,
	"sort_order" integer NOT NULL,
	"default_for" text[] NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_catalog_adult_not_default" CHECK (not ('adult_content' = any("model_access"."model_catalog"."capabilities") and cardinality("model_access"."model_catalog"."default_for") > 0))
);
--> statement-breakpoint
CREATE TABLE "model_access"."selections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"chat_model_key" text,
	"background_model_key" text,
	"adult_model_key" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_access"."upstream_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upstream_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" text NOT NULL,
	"failure" text,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_access"."upstreams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"display_prefix" text NOT NULL,
	"display_suffix" text NOT NULL,
	"status" text NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"last_tested_at" timestamp with time zone,
	"key_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upstreams_status_check" CHECK ("model_access"."upstreams"."status" in ('active', 'invalid', 'quota_exhausted', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "model_access"."usage_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"character_id" uuid,
	"conversation_id" uuid,
	"conversation_kind" text,
	"purpose" text NOT NULL,
	"billing_owner" text NOT NULL,
	"model_role" text NOT NULL,
	"model_key" text NOT NULL,
	"upstream_id" uuid NOT NULL,
	"upstream_model_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"retry_count" integer NOT NULL,
	"input_tokens" integer NOT NULL,
	"cached_input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"ttft_ms" integer,
	"safety_priority" boolean NOT NULL,
	"counts_as_background" boolean NOT NULL,
	"hold_id" uuid,
	"price_version_id" uuid,
	"ledger_entry_id" uuid,
	"charged_micros" bigint NOT NULL,
	"cost_micros" bigint NOT NULL,
	"absorbed_cost_micros" bigint NOT NULL,
	"safety_overdraft" boolean NOT NULL,
	"snapshot_at" timestamp with time zone,
	"persona_version" integer,
	"prompt_template_version" text,
	"scenario_mode" text,
	CONSTRAINT "usage_records_status_check" CHECK ("model_access"."usage_records"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "usage_records_owner_check" CHECK ("model_access"."usage_records"."billing_owner" in ('user', 'platform')),
	CONSTRAINT "usage_records_kind_check" CHECK ("model_access"."usage_records"."conversation_kind" is null or "model_access"."usage_records"."conversation_kind" in ('direct', 'group')),
	CONSTRAINT "usage_records_nonnegative" CHECK ("model_access"."usage_records"."input_tokens" >= 0 and "model_access"."usage_records"."cached_input_tokens" >= 0 and "model_access"."usage_records"."output_tokens" >= 0
          and "model_access"."usage_records"."latency_ms" >= 0 and "model_access"."usage_records"."retry_count" >= 0 and "model_access"."usage_records"."charged_micros" >= 0
          and "model_access"."usage_records"."cost_micros" >= 0 and "model_access"."usage_records"."absorbed_cost_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "model_access"."upstream_status" ADD CONSTRAINT "upstream_status_upstream_id_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "model_access"."upstreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_overrides_character_idx" ON "model_access"."character_overrides" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "model_catalog_upstream_idx" ON "model_access"."model_catalog" USING btree ("upstream_id");--> statement-breakpoint
CREATE INDEX "upstream_status_upstream_idx" ON "model_access"."upstream_status" USING btree ("upstream_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_records_idempotency_key" ON "model_access"."usage_records" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_records_created_idx" ON "model_access"."usage_records" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "usage_records_user_created_idx" ON "model_access"."usage_records" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_character_created_idx" ON "model_access"."usage_records" USING btree ("character_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_records_model_created_idx" ON "model_access"."usage_records" USING btree ("model_key","created_at");