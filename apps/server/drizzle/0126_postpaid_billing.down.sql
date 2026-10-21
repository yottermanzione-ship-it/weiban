-- 回滚 0126：去掉 postpaid 标记与估算金额。注意：回滚后旧代码不允许用户余额为负；已欠费的账户余额保持负数
-- （流水不改），旧代码下这些用户的付费调用会因可用余额不足被拒，直到充值。仍有效的 postpaid 冻结金额为 0，
-- 按旧规则结算时用户上限为 0（不扣钱、平台承担），请在没有进行中调用时回滚。
DROP INDEX IF EXISTS billing.accounts_debt_idx;
ALTER TABLE billing.holds DROP CONSTRAINT IF EXISTS holds_estimate_nonnegative;
ALTER TABLE billing.holds
  DROP COLUMN IF EXISTS postpaid,
  DROP COLUMN IF EXISTS estimate_micros;
