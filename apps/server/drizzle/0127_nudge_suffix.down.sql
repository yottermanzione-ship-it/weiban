-- 回滚 0127：删除拍一拍后缀（已发出的拍一拍消息里存有当时的后缀快照，不受影响）。
ALTER TABLE identity.profiles DROP CONSTRAINT IF EXISTS profiles_nudge_suffix_length;
ALTER TABLE identity.profiles DROP COLUMN IF EXISTS nudge_suffix;
