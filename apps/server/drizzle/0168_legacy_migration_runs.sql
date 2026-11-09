-- Operational execution ledger. No private migration payloads, credentials or source text.
CREATE TABLE platform.legacy_migration_target_identity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 installation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.legacy_migration_target_identity(singleton) VALUES(true);

CREATE TABLE platform.legacy_migration_runs (
 run_id uuid PRIMARY KEY,
 mode text NOT NULL CHECK(mode IN ('rehearsal','production')),
 manifest_digest text NOT NULL CHECK(manifest_digest ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 schema_digest text NOT NULL CHECK(schema_digest ~ '^[a-f0-9]{64}$'),
 policy_digest text NOT NULL CHECK(policy_digest ~ '^[a-f0-9]{64}$'),
 code_sha text NOT NULL CHECK(code_sha ~ '^[a-f0-9]{40}$'),
 status text NOT NULL CHECK(status IN ('prepared','executing','verified','closed','released','halted')),
 baseline_business_counter bigint NOT NULL CHECK(baseline_business_counter>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz
);
CREATE UNIQUE INDEX legacy_migration_one_active_target ON platform.legacy_migration_runs(target_digest)
 WHERE status IN ('prepared','executing','verified');

CREATE TABLE platform.legacy_migration_units (
 run_id uuid NOT NULL REFERENCES platform.legacy_migration_runs(run_id),
 unit_key text NOT NULL CHECK(unit_key ~ '^[a-f0-9]{64}$'),
 unit_digest text NOT NULL CHECK(unit_digest ~ '^[a-f0-9]{64}$'),
 domain text NOT NULL,
 handler_digest text NOT NULL CHECK(handler_digest ~ '^[a-f0-9]{64}$'),
 plan_digest text NOT NULL CHECK(plan_digest ~ '^[a-f0-9]{64}$'),
 before_digest text NOT NULL CHECK(before_digest ~ '^[a-f0-9]{64}$'),
 after_digest text NOT NULL CHECK(after_digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','reused')),
 receipt_digest text CHECK(receipt_digest ~ '^[a-f0-9]{64}$'),
 result_counts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(result_counts)='object'),
 committed_at timestamptz,
 PRIMARY KEY(run_id,unit_key)
);

CREATE TABLE platform.legacy_migration_events (
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 domain text NOT NULL,
 event_key text NOT NULL CHECK(event_key ~ '^[a-f0-9]{64}$'),
 event_digest text NOT NULL CHECK(event_digest ~ '^[a-f0-9]{64}$'),
 run_id uuid NOT NULL,
 unit_key text NOT NULL,
 unit_digest text NOT NULL CHECK(unit_digest ~ '^[a-f0-9]{64}$'),
 after_digest text NOT NULL CHECK(after_digest ~ '^[a-f0-9]{64}$'),
 applied_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(target_digest,domain,event_key),
 FOREIGN KEY(run_id,unit_key) REFERENCES platform.legacy_migration_units(run_id,unit_key)
);

CREATE TABLE platform.legacy_migration_evidence (
 evidence_id uuid PRIMARY KEY,
 run_id uuid NOT NULL REFERENCES platform.legacy_migration_runs(run_id),
 unit_key text,
 operation text NOT NULL,
 challenge_id uuid NOT NULL UNIQUE,
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[a-f0-9]{64}$'),
 maintenance_digest text NOT NULL CHECK(maintenance_digest ~ '^[a-f0-9]{64}$'),
 authorization_digest text NOT NULL CHECK(authorization_digest ~ '^[a-f0-9]{64}$'),
 issuer_key_digests jsonb NOT NULL,
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform.legacy_migration_attempts (
 attempt_id uuid PRIMARY KEY,
 run_id uuid NOT NULL,
 unit_key text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('unconfirmed','recovered','retryable')),
 failure_code text,
 observed_digest text CHECK(observed_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(run_id,unit_key) REFERENCES platform.legacy_migration_units(run_id,unit_key)
);
