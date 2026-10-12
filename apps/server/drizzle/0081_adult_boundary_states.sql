CREATE TABLE ai_runtime.adult_boundary_states (
 user_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 character_id uuid NOT NULL,
 evidence_ciphertext bytea NOT NULL,
 triggered_at timestamptz NOT NULL,
 PRIMARY KEY (user_id, conversation_id, character_id)
);
