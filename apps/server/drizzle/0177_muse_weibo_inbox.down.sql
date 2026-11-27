DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_runtime.muse_weibo_inbox) THEN
    RAISE EXCEPTION 'Muse Weibo receipts exist; refusing to discard pending submissions or deduplication history';
  END IF;
END $$;
DROP TABLE ai_runtime.muse_weibo_inbox;
DROP INDEX contacts.contact_character_active_user_idx;
DROP INDEX moments.moments_forwarded_source_idx;
ALTER TABLE identity.admin_api_keys DROP CONSTRAINT admin_api_keys_scope_check;
DELETE FROM identity.admin_api_keys WHERE scope = 'muse-weibo:publish';
ALTER TABLE identity.admin_api_keys ADD CONSTRAINT admin_api_keys_scope_check
  CHECK (scope IN ('role-requests:complete'));
