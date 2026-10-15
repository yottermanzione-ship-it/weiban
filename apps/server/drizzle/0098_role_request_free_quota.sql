ALTER TABLE plaza.role_requests ADD COLUMN free_quota_applied boolean NOT NULL DEFAULT false;
CREATE INDEX role_requests_free_quota_idx ON plaza.role_requests (user_id, created_at) WHERE free_quota_applied = true;
