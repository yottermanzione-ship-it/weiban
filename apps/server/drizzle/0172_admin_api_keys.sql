CREATE TABLE identity.admin_api_keys (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  key_hash bytea NOT NULL,
  key_prefix text NOT NULL,
  scope text NOT NULL,
  created_by uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT admin_api_keys_scope_check CHECK (scope IN ('role-requests:complete'))
);
CREATE UNIQUE INDEX admin_api_keys_key_hash_key ON identity.admin_api_keys (key_hash);
CREATE INDEX admin_api_keys_created_by_idx ON identity.admin_api_keys (created_by);
