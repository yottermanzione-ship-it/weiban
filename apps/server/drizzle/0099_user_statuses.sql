CREATE TABLE identity.user_statuses (user_id uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE, preset text NOT NULL, text text, set_at timestamptz NOT NULL, expires_at timestamptz);
