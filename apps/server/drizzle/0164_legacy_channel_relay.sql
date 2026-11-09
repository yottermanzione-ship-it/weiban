-- Temporary legacy transport: credentials and external connections stay on the old host.
-- A row is an operator-approved immutable binding/generation -> existing owner/direct conversation.
-- Disabled by default. No arbitrary-user HTTP provisioning endpoint exists.
CREATE TABLE channels.legacy_bindings (
  id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('wechat','weibo','qq')),
  legacy_binding_id text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  peer_hash text NOT NULL CHECK (peer_hash ~ '^[0-9a-f]{64}$'),
  persona_hash text NOT NULL CHECK (persona_hash ~ '^[0-9a-f]{64}$'),
  auth_key_sealed bytea NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  user_disabled boolean NOT NULL DEFAULT false,
  after_seq bigint NOT NULL CHECK (after_seq >= 0),
  offered_seq bigint NOT NULL CHECK (offered_seq >= after_seq),
  cutover_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE(channel, legacy_binding_id, generation)
);
CREATE INDEX legacy_bindings_owner_idx ON channels.legacy_bindings(user_id);
