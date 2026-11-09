-- Personal structured legacy persona state. Public character data is never overwritten.
CREATE TABLE characters.legacy_persona_overrides (
 user_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>=1),
 state text NOT NULL CHECK(state IN ('active','blocked','reset')),
 source_key text CHECK(source_key ~ '^[a-f0-9]{64}$'),
 source_version integer CHECK(source_version>=0),
 source_digest text CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 source_updated_at timestamptz,
 ciphertext bytea,
 blocked_reason text,
 child_features_detected boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,character_id),
 UNIQUE(user_id,source_key),
 CHECK((state='reset' AND ciphertext IS NULL AND blocked_reason IS NULL) OR (state IN ('active','blocked') AND ciphertext IS NOT NULL)),
 CHECK((state='blocked')=(blocked_reason IS NOT NULL))
);
CREATE TABLE characters.legacy_persona_sources (
 user_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
 source_key text NOT NULL CHECK(source_key ~ '^[a-f0-9]{64}$'),
 source_version integer NOT NULL CHECK(source_version>=0),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 result_version integer NOT NULL,
 imported_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,source_key,source_version)
);
CREATE TABLE characters.legacy_persona_commands (
 user_id uuid NOT NULL,
 command_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 result_version integer NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,command_id)
);
