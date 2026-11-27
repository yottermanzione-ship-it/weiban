ALTER TABLE chat.conversations ADD COLUMN reply_quiet_until timestamptz, ADD COLUMN reply_batch_key text;
--> statement-breakpoint
ALTER TABLE ai_runtime.reply_plans ADD COLUMN batch_first_seq bigint;
--> statement-breakpoint
ALTER TABLE chat.messages ADD COLUMN reply_batch_first_seq bigint;
--> statement-breakpoint
CREATE INDEX chat_user_reply_seq_idx ON chat.messages(conversation_id, seq DESC) WHERE sender_kind='user' AND status='normal';
--> statement-breakpoint
CREATE TABLE platform.reply_worker_slots (
  slot smallint PRIMARY KEY, user_id uuid, lease_id uuid, expires_at timestamptz, started_at timestamptz
);
--> statement-breakpoint
INSERT INTO platform.reply_worker_slots(slot) VALUES (1),(2),(3),(4);
--> statement-breakpoint
CREATE TABLE chat.reply_batch_parts (
  conversation_id uuid NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
  next_key text NOT NULL, first_seq bigint NOT NULL, last_seq bigint NOT NULL,
  PRIMARY KEY(conversation_id,next_key)
);
