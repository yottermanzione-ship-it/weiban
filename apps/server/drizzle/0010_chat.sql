CREATE SCHEMA "chat";
--> statement-breakpoint
CREATE TABLE "chat"."conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"character_id" uuid,
	"title" text,
	"system_participant_id" uuid NOT NULL,
	"content_scope" text DEFAULT 'normal' NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_type" CHECK ("chat"."conversations"."type" IN ('direct','group')),
	CONSTRAINT "conversation_scope" CHECK ("chat"."conversations"."content_scope" IN ('normal','adult')),
	CONSTRAINT "conversation_seq" CHECK ("chat"."conversations"."last_seq" >= 0 AND "chat"."conversations"."last_seq" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "chat"."hidden_messages" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "hidden_messages_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat"."messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"sender_participant_id" uuid NOT NULL,
	"sender_kind" text NOT NULL,
	"client_msg_id" text NOT NULL,
	"content_ciphertext" "bytea",
	"quote_message_id" uuid,
	"status" text DEFAULT 'normal' NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"recalled_at" timestamp with time zone,
	CONSTRAINT "message_sender_kind" CHECK ("chat"."messages"."sender_kind" IN ('user','character','system')),
	CONSTRAINT "message_scope" CHECK ("chat"."messages"."scope" IN ('normal','adult')),
	CONSTRAINT "message_status" CHECK ("chat"."messages"."status" IN ('normal','recalled')),
	CONSTRAINT "message_seq" CHECK ("chat"."messages"."seq" > 0 AND "chat"."messages"."seq" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "chat"."participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"read_seq" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "participant_kind" CHECK ("chat"."participants"."kind" IN ('user','character')),
	CONSTRAINT "participant_read_seq" CHECK ("chat"."participants"."read_seq" >= 0 AND "chat"."participants"."read_seq" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "chat"."user_conversation_states" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"cleared_through_seq" bigint DEFAULT 0 NOT NULL,
	"read_seq" bigint DEFAULT 0 NOT NULL,
	"marked_unread" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_conversation_states_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "state_read_seq" CHECK ("chat"."user_conversation_states"."read_seq" >= 0 AND "chat"."user_conversation_states"."read_seq" <= 9007199254740991),
	CONSTRAINT "state_cleared_seq" CHECK ("chat"."user_conversation_states"."cleared_through_seq" >= 0 AND "chat"."user_conversation_states"."cleared_through_seq" <= 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "chat"."hidden_messages" ADD CONSTRAINT "hidden_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "chat"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."participants" ADD CONSTRAINT "participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat"."user_conversation_states" ADD CONSTRAINT "user_conversation_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "chat"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "direct_user_character_idx" ON "chat"."conversations" USING btree ("owner_user_id","character_id");--> statement-breakpoint
CREATE INDEX "conversations_owner_idx" ON "chat"."conversations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "message_seq_idx" ON "chat"."messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "message_idempotency_idx" ON "chat"."messages" USING btree ("conversation_id","sender_participant_id","client_msg_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_ref_idx" ON "chat"."participants" USING btree ("conversation_id","kind","ref_id");