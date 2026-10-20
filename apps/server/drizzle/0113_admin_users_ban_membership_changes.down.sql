DROP TABLE IF EXISTS identity.membership_changes;
ALTER TABLE identity.users DROP COLUMN IF EXISTS banned_by;
ALTER TABLE identity.users DROP COLUMN IF EXISTS ban_reason;
ALTER TABLE identity.users DROP COLUMN IF EXISTS banned_at;
