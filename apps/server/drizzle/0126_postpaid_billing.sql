-- 10-21 试用反馈第四轮 H1-2（契约 3.27）：扣费改为「先用后扣、可欠一次」，取代 3.16「先冻结后结算、不透支」。
-- 新的用户付费调用不再冻结积分（holds.amount_micros = 0、不加 held_micros），只记一条 postpaid 冻结记录用于
-- 幂等、并发计数（同一用户同时进行的付费调用上限）与结算关联；结算按实际用量全额扣，余额可以变成负数。
-- estimate_micros：调用前按「本平台实际发送的上下文 + 模型最大输出」估的售价，只做异常巨额拦截与排查用。
-- 旧（升级前创建、仍有效）的冻结 postpaid = false，照旧规则结算 / 解冻 / 过期。
ALTER TABLE billing.holds
  ADD COLUMN postpaid boolean NOT NULL DEFAULT false,
  ADD COLUMN estimate_micros bigint NOT NULL DEFAULT 0;
ALTER TABLE billing.holds ADD CONSTRAINT holds_estimate_nonnegative CHECK (estimate_micros >= 0);
-- 欠费名单（后台对账）按余额为负查询。
CREATE INDEX accounts_debt_idx ON billing.accounts (balance_micros) WHERE kind = 'user' AND balance_micros < 0;
