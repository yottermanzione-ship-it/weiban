-- 10-20 批 E2：后台用户与会员管理重排。
-- ① 账号封禁：封禁后不能登录、全部会话作废；数据保留，可解封。
ALTER TABLE identity.users ADD COLUMN banned_at timestamptz;
ALTER TABLE identity.users ADD COLUMN ban_reason text;
ALTER TABLE identity.users ADD COLUMN banned_by uuid;
-- ② 会员手动调整记录（改到期日 / 取消），与 billing.membership_orders（开通 / 续期）合起来就是「会员订阅记录」。
CREATE TABLE identity.membership_changes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  previous_until timestamptz,
  new_until timestamptz,
  operator_user_id uuid,
  reason text,
  created_at timestamptz NOT NULL
);
CREATE INDEX membership_changes_user_idx ON identity.membership_changes (user_id, created_at);
CREATE INDEX membership_changes_created_idx ON identity.membership_changes (created_at);
