-- 会员 v5（16 号 §6）：申请制作免费次数分「终身」与「PRO+ 每周」两类；拒绝 / 撤回退还次数（按状态计数，不新增列）。
ALTER TABLE plaza.role_requests ADD COLUMN free_quota_kind text,
  ADD CONSTRAINT role_requests_free_quota_kind_check CHECK (free_quota_kind IS NULL OR free_quota_kind IN ('lifetime', 'weekly'));
UPDATE plaza.role_requests SET free_quota_kind = 'lifetime' WHERE free_quota_applied;
