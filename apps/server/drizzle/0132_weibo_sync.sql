CREATE TABLE billing.shared_search_calls (
 id uuid PRIMARY KEY, request_key text NOT NULL UNIQUE, character_id uuid NOT NULL,
 model_key text NOT NULL, state text NOT NULL CHECK (state IN ('pending','settled','cancelled')),
 member_count integer NOT NULL CHECK (member_count > 0), ceiling_micros bigint NOT NULL CHECK (ceiling_micros >= 0),
 usage_record_id uuid UNIQUE, collected_micros bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE billing.shared_search_members (
 call_id uuid NOT NULL REFERENCES billing.shared_search_calls(id),
 account_id uuid NOT NULL REFERENCES billing.accounts(id) ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK (ordinal >= 0), charged_micros bigint NOT NULL DEFAULT 0, PRIMARY KEY(call_id,account_id)
);
CREATE INDEX shared_search_members_account_idx ON billing.shared_search_members(account_id);
CREATE TABLE billing.shared_search_carries (
 account_id uuid NOT NULL REFERENCES billing.accounts(id) ON DELETE CASCADE,
 character_id uuid NOT NULL, carry_micros integer NOT NULL CHECK(carry_micros BETWEEN -50 AND 99),
 PRIMARY KEY(account_id,character_id)
);
CREATE TABLE ai_runtime.weibo_sync_states (
 character_id uuid PRIMARY KEY, lease_token uuid NOT NULL, lease_until timestamptz NOT NULL,
 next_allowed_at timestamptz NOT NULL, day text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 pending_key text, last_success_at timestamptz
);
CREATE TABLE ai_runtime.weibo_items (
 id uuid PRIMARY KEY, character_id uuid NOT NULL, source_key text NOT NULL,content_key text NOT NULL,public_update_id uuid NOT NULL,
 source_url text NOT NULL, content text NOT NULL, published_on text NOT NULL,
 created_at timestamptz NOT NULL, UNIQUE(character_id,source_key),UNIQUE(character_id,content_key)
);
CREATE TABLE ai_runtime.weibo_deliveries (
 item_id uuid NOT NULL REFERENCES ai_runtime.weibo_items(id) ON DELETE CASCADE,
 user_id uuid NOT NULL, post_id uuid NOT NULL, PRIMARY KEY(item_id,user_id)
);
CREATE TABLE model_access.shared_search_receipts (
 request_key text PRIMARY KEY, character_id uuid NOT NULL, group_id uuid NOT NULL, usage_record_id uuid NOT NULL,
 is_free boolean NOT NULL, items jsonb NOT NULL, created_at timestamptz NOT NULL
);
ALTER TABLE characters.public_updates DROP CONSTRAINT public_updates_source_check;
ALTER TABLE characters.public_updates ADD CONSTRAINT public_updates_source_check CHECK(source IN ('manual','auto_search','weibo_sync'));
CREATE UNIQUE INDEX public_updates_weibo_key_idx ON characters.public_updates(character_id,source_key) WHERE source='weibo_sync';
