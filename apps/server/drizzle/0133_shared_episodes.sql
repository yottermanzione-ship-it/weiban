CREATE TABLE ai_runtime.shared_episodes (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, character_id uuid NOT NULL, epoch uuid NOT NULL,
 scope text NOT NULL CHECK(scope IN ('normal','adult')), kind text NOT NULL,
 source_key text NOT NULL, ciphertext bytea, embedding vector(256), importance integer NOT NULL CHECK(importance BETWEEN 1 AND 10),
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL, deleted_at timestamptz, archive_month text,
 UNIQUE(user_id,character_id,epoch,source_key)
);
CREATE INDEX shared_episodes_owner_idx ON ai_runtime.shared_episodes(user_id,character_id,epoch,occurred_at DESC);
CREATE INDEX shared_episodes_source_idx ON ai_runtime.shared_episodes(source_key);
CREATE TABLE ai_runtime.shared_episode_states (
 user_id uuid NOT NULL, character_id uuid NOT NULL, epoch uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('normal','adult')),
 frozen_at timestamptz NOT NULL, ciphertext bytea NOT NULL, PRIMARY KEY(user_id,character_id,epoch,scope)
);
CREATE TABLE ai_runtime.shared_episode_months (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, character_id uuid NOT NULL, epoch uuid NOT NULL,
 scope text NOT NULL CHECK(scope IN ('normal','adult')), month text NOT NULL, ciphertext bytea NOT NULL,
 UNIQUE(user_id,character_id,epoch,scope,month)
);
