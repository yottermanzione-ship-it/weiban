ALTER TABLE characters.characters ADD COLUMN is_trial boolean NOT NULL DEFAULT false;
CREATE TABLE characters.trial_sessions (
  conversation_id uuid PRIMARY KEY,
  character_id uuid NOT NULL UNIQUE REFERENCES characters.characters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_character_id uuid,
  source_revision integer,
  reusable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX trial_sessions_expiry_idx ON characters.trial_sessions(expires_at);
CREATE INDEX trial_sessions_user_idx ON characters.trial_sessions(user_id);
