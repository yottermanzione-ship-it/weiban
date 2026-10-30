ALTER TABLE ai_runtime.memory_states ADD COLUMN fact_trigger_seq bigint NOT NULL DEFAULT 0, ADD COLUMN fact_attempts integer NOT NULL DEFAULT 0;
CREATE TABLE ai_runtime.chat_summary_states (
 id uuid PRIMARY KEY,
 parent_id uuid NOT NULL REFERENCES ai_runtime.memory_states(id) ON DELETE CASCADE,
 scope text NOT NULL CHECK (scope IN ('normal','adult')),
 covered_seq bigint NOT NULL DEFAULT 0 CHECK (covered_seq >= 0),
 target_seq bigint NOT NULL DEFAULT 0 CHECK (target_seq >= 0),
 partial_offset integer NOT NULL DEFAULT 0 CHECK (partial_offset >= 0),
 partial_message_id uuid,
 version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
 ciphertext bytea,
 prepared_ciphertext bytea,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 retry_after timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 updated_at timestamptz NOT NULL,
 CONSTRAINT chat_summary_parent_scope_idx UNIQUE(parent_id,scope)
);
CREATE TABLE ai_runtime.chat_summary_versions (
 id uuid PRIMARY KEY,
 state_id uuid NOT NULL REFERENCES ai_runtime.chat_summary_states(id) ON DELETE CASCADE,
 version integer NOT NULL,
 from_seq bigint NOT NULL,
 to_seq bigint NOT NULL,
 ciphertext bytea NOT NULL,
 created_at timestamptz NOT NULL,
 CONSTRAINT chat_summary_version_idx UNIQUE(state_id,version)
);
CREATE INDEX chat_summary_due_idx ON ai_runtime.chat_summary_states(retry_after) WHERE target_seq > covered_seq;
