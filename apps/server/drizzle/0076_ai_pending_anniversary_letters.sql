CREATE TABLE ai_runtime.pending_anniversary_letters (
  plan_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  payload_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX pending_anniversary_letters_user ON ai_runtime.pending_anniversary_letters (user_id);
