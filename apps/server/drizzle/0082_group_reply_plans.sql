CREATE TABLE ai_runtime.group_reply_plans (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 trigger_message_id uuid NOT NULL,
 trigger_seq bigint NOT NULL CONSTRAINT group_reply_trigger_positive CHECK (trigger_seq > 0),
 scope text NOT NULL CONSTRAINT group_reply_scope CHECK (scope IN ('normal','adult')),
 status text NOT NULL CONSTRAINT group_reply_status CHECK (status IN ('queued','generating','waiting','done','cancelled')),
 next_ordinal integer NOT NULL DEFAULT 0 CONSTRAINT group_reply_ordinal CHECK (next_ordinal >= 0 AND next_ordinal <= 6),
 retry_epoch integer NOT NULL DEFAULT 0 CONSTRAINT group_reply_retry_epoch CHECK (retry_epoch >= 0),
 plan_ciphertext bytea,
 input_ciphertext bytea,
 result_ciphertext bytea,
 lease_id uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 UNIQUE (user_id, conversation_id, trigger_message_id)
);
--> statement-breakpoint
CREATE INDEX group_reply_waiting_idx ON ai_runtime.group_reply_plans(user_id,status,updated_at);
