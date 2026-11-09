-- Owner/group-scoped compatibility records. No individual character owns the shared source text.
CREATE TABLE ai_runtime.legacy_group_memory_sources (
 user_id uuid NOT NULL,
 source_account_id uuid NOT NULL CHECK(source_account_id=user_id),
 source_group_id text NOT NULL,
 conversation_id uuid NOT NULL,
 source_archived boolean NOT NULL,
 activation_allowed boolean NOT NULL DEFAULT false,
 review_digest text NOT NULL CHECK(review_digest ~ '^[a-f0-9]{64}$'),
 target_digest text NOT NULL CHECK(target_digest ~ '^[a-f0-9]{64}$'),
 generation integer NOT NULL CHECK(generation>=0),
 source_batch text NOT NULL,
 deleted_at timestamptz,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,source_group_id),
 UNIQUE(user_id,conversation_id)
);
CREATE TABLE ai_runtime.legacy_group_memories (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 source_group_id text NOT NULL,
 source_memory_id text NOT NULL,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 conversation_id uuid NOT NULL,
 source_enabled boolean NOT NULL,
 activation_allowed boolean NOT NULL DEFAULT false,
 blocked_reason text,
 ciphertext bytea,
 encoded_bytes integer NOT NULL CHECK(encoded_bytes>=2),
 source_created_at timestamptz NOT NULL,
 imported_at timestamptz NOT NULL,
 deleted_at timestamptz,
 UNIQUE(user_id,source_group_id,source_memory_id),
 CHECK((deleted_at IS NULL AND ciphertext IS NOT NULL) OR (deleted_at IS NOT NULL AND ciphertext IS NULL))
);
CREATE INDEX legacy_group_memories_read_idx ON ai_runtime.legacy_group_memories(user_id,conversation_id,source_created_at DESC,source_memory_id DESC) WHERE deleted_at IS NULL AND source_enabled AND activation_allowed;
-- Survives removal/reset of a character's ordinary memory rows, fencing old shared-source replay.
CREATE TABLE ai_runtime.legacy_group_memory_exclusions (
 user_id uuid NOT NULL,
 character_id uuid NOT NULL,
 blocked_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,character_id)
);
