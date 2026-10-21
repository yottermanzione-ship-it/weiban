CREATE SCHEMA client_logs;
-- fingerprint is the deliberate natural key of a technical issue; event IDs remain UUIDv7.
CREATE TABLE client_logs.issue_groups (
 fingerprint text PRIMARY KEY CHECK(length(fingerprint)=64), kind text NOT NULL, app_kind text NOT NULL,
 title text NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
 total_count bigint NOT NULL DEFAULT 0, first_version text NOT NULL, last_version text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored')),
 note text NOT NULL DEFAULT '', alerted boolean NOT NULL DEFAULT false
);
CREATE INDEX client_issues_recent ON client_logs.issue_groups(last_seen_at DESC);
CREATE TABLE client_logs.events (
 id uuid PRIMARY KEY, fingerprint text NOT NULL REFERENCES client_logs.issue_groups(fingerprint) ON DELETE CASCADE,
 owner_key text NOT NULL, client_id uuid NOT NULL, user_id uuid, session_id uuid NOT NULL,
 version text NOT NULL, count integer NOT NULL, event jsonb NOT NULL,
 occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL,
 UNIQUE(owner_key,client_id)
);
CREATE INDEX client_events_user ON client_logs.events(user_id,received_at DESC);
CREATE INDEX client_events_issue ON client_logs.events(fingerprint,received_at DESC);
CREATE INDEX client_events_session ON client_logs.events(owner_key,session_id);
CREATE INDEX client_events_retention ON client_logs.events(received_at);
CREATE TABLE client_logs.group_users (
 fingerprint text NOT NULL REFERENCES client_logs.issue_groups(fingerprint) ON DELETE CASCADE,
 user_id uuid NOT NULL, last_seen_at timestamptz NOT NULL, PRIMARY KEY(fingerprint,user_id)
);
CREATE TABLE client_logs.issue_days (
 fingerprint text NOT NULL REFERENCES client_logs.issue_groups(fingerprint) ON DELETE CASCADE,
 day date NOT NULL, count bigint NOT NULL, PRIMARY KEY(fingerprint,day)
);
CREATE INDEX client_group_users_recent ON client_logs.group_users(fingerprint,last_seen_at DESC);
CREATE TABLE client_logs.sessions (
 owner_key text NOT NULL, session_id uuid NOT NULL, user_id uuid, app_kind text NOT NULL,
 version text NOT NULL, build text NOT NULL, seen_at timestamptz NOT NULL,
 PRIMARY KEY(owner_key,session_id)
);
CREATE TABLE client_logs.rate_windows (
 key text PRIMARY KEY, user_id uuid, expires_at timestamptz NOT NULL, count integer NOT NULL
);
CREATE INDEX client_sessions_version ON client_logs.sessions(app_kind,version,seen_at);
CREATE INDEX client_sessions_retention ON client_logs.sessions(seen_at);
CREATE INDEX client_rate_retention ON client_logs.rate_windows(expires_at);
CREATE TABLE client_logs.release_versions (
 app_kind text NOT NULL, version text NOT NULL, first_seen_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
 PRIMARY KEY(app_kind,version)
);
CREATE TABLE client_logs.ticket_events (
 ticket_id uuid PRIMARY KEY, user_id uuid NOT NULL, events jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX client_ticket_events_user ON client_logs.ticket_events(user_id);
CREATE INDEX client_ticket_events_retention ON client_logs.ticket_events(created_at);
