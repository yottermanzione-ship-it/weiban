ALTER TABLE identity.admin_api_keys DROP CONSTRAINT admin_api_keys_scope_check;
ALTER TABLE identity.admin_api_keys ADD CONSTRAINT admin_api_keys_scope_check
  CHECK (scope IN ('role-requests:complete', 'muse-weibo:publish'));

CREATE TABLE ai_runtime.muse_weibo_inbox (
  id uuid PRIMARY KEY,
  character_id uuid NOT NULL,
  author_nickname text NOT NULL,
  author_weibo_id text NOT NULL,
  source_url text NOT NULL,
  text text NOT NULL,
  published_on date NOT NULL,
  accepted_at timestamptz NOT NULL,
  public_update_id uuid,
  recipient_cursor uuid,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'publishing', 'published', 'blocked', 'withdrawn')),
  next_attempt_at timestamptz NOT NULL,
  UNIQUE (character_id, source_url)
);

CREATE INDEX muse_weibo_due_idx ON ai_runtime.muse_weibo_inbox (next_attempt_at, accepted_at, id)
  WHERE state IN ('queued', 'publishing', 'blocked');

CREATE INDEX muse_weibo_recipient_cursor_idx ON ai_runtime.muse_weibo_inbox (recipient_cursor)
  WHERE recipient_cursor IS NOT NULL;
CREATE INDEX muse_weibo_character_history_idx ON ai_runtime.muse_weibo_inbox (character_id, id)
  WHERE public_update_id IS NOT NULL;
CREATE INDEX moments_forwarded_source_idx ON moments.posts (owner_user_id, author_character_id, source_id)
  WHERE forwarded_public AND source_kind = 'public_update';

CREATE INDEX contact_character_active_user_idx ON contacts.contacts (character_id, user_id)
  WHERE status = 'active';
