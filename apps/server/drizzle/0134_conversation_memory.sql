ALTER TABLE ai_runtime.memories ADD COLUMN origin text CHECK(origin IN ('private_chat','group','call','system'));
CREATE TABLE ai_runtime.group_memory_states (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, conversation_id uuid NOT NULL,
 cursor_seq bigint NOT NULL DEFAULT 0, last_user_seq bigint NOT NULL DEFAULT 0, pending_count integer NOT NULL DEFAULT 0,
 last_user_at timestamptz NOT NULL, lease_id uuid, lease_until timestamptz, retry_after timestamptz,
 prepared_ciphertext bytea, result_ciphertext bytea, generation integer NOT NULL DEFAULT 0,
 UNIQUE(user_id,conversation_id), CHECK(cursor_seq>=0 AND last_user_seq>=0 AND pending_count>=0)
);
CREATE INDEX group_memory_pending_idx ON ai_runtime.group_memory_states(retry_after,last_user_at) WHERE pending_count>0;
CREATE TABLE ai_runtime.call_memory_jobs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, character_id uuid NOT NULL, conversation_id uuid NOT NULL,
 epoch uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('normal','adult')),
 revision integer NOT NULL, ciphertext bytea, result_ciphertext bytea,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')),
 lease_id uuid, lease_until timestamptz, retry_after timestamptz, created_at timestamptz NOT NULL
);
