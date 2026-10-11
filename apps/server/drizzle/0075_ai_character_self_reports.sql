CREATE TABLE ai_runtime.character_self_reports (
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  topic_key text NOT NULL,
  answer_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('normal', 'adult')),
  payload_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, character_id, topic_key)
);
