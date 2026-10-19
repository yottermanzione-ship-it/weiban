ALTER TABLE plaza.role_requests DROP CONSTRAINT IF EXISTS role_requests_free_quota_kind_check, DROP COLUMN IF EXISTS free_quota_kind;
