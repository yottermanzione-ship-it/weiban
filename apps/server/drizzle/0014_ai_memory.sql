CREATE TABLE "ai_runtime"."memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"client_id" uuid,
	"scope" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memory_client_idx" UNIQUE("user_id","character_id","client_id"),
	CONSTRAINT "memory_scope" CHECK ("ai_runtime"."memories"."scope" IN ('normal','adult'))
);
--> statement-breakpoint
CREATE TABLE "ai_runtime"."memory_states" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"retry_after" timestamp with time zone,
	"barrier_seq" bigint DEFAULT 0 NOT NULL,
	"cursor_seq" bigint DEFAULT 0 NOT NULL,
	"summary_ciphertext" "bytea",
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "memory_state_owner_idx" UNIQUE("user_id","character_id","conversation_id"),
	CONSTRAINT "memory_state_counters" CHECK ("ai_runtime"."memory_states"."pending_count" >= 0 AND "ai_runtime"."memory_states"."revision" >= 0 AND "ai_runtime"."memory_states"."barrier_seq" >= 0 AND "ai_runtime"."memory_states"."cursor_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "persona_fit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "scenario_mode" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "proactive_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "proactive_frequency" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "proactive_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD COLUMN "daily_life" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "memory_owner_idx" ON "ai_runtime"."memories" USING btree ("user_id","character_id","conversation_id","id");--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD CONSTRAINT "companion_persona_fit" CHECK ("ai_runtime"."companion_settings"."persona_fit" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD CONSTRAINT "companion_mode" CHECK ("ai_runtime"."companion_settings"."scenario_mode" IN ('daily','tsundere','romance','adult'));--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD CONSTRAINT "companion_frequency" CHECK ("ai_runtime"."companion_settings"."proactive_frequency" IN ('low','medium','high'));