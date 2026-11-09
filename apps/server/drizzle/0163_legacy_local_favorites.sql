CREATE TABLE library.legacy_favorite_sources (
 user_id uuid NOT NULL,
 account_key text NOT NULL CHECK (account_key ~ '^[a-z0-9]{4,20}$'),
 source_user_id uuid NOT NULL CHECK (source_user_id=user_id),
 source_batch text NOT NULL,
 verified_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,account_key),
 UNIQUE(account_key)
);
CREATE TABLE library.legacy_favorites (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 account_key text NOT NULL,
 item_key text NOT NULL CHECK (item_key ~ '^[a-f0-9]{64}$'),
 snapshot_ciphertext bytea,
 saved_at timestamptz NOT NULL,
 imported_at timestamptz NOT NULL,
 deleted_at timestamptz,
 CONSTRAINT legacy_favorite_payload CHECK ((deleted_at IS NULL AND snapshot_ciphertext IS NOT NULL) OR (deleted_at IS NOT NULL AND snapshot_ciphertext IS NULL)),
 UNIQUE(user_id,account_key,item_key)
);
CREATE INDEX legacy_favorites_user_time_idx ON library.legacy_favorites(user_id,saved_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE library.legacy_favorite_media_links (
 user_id uuid NOT NULL,
 reference_hash text NOT NULL CHECK (reference_hash ~ '^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN ('image','voice')),
 media_id uuid NOT NULL,
 source_batch text NOT NULL,
 PRIMARY KEY(user_id,reference_hash,kind)
);
