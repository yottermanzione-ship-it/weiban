-- 会员 v5（16 号 §3）：赠送积分与充值积分分账（赠送部分是 balance_micros 的一部分，扣费先扣赠送）；PRO+ 开通订单。
ALTER TABLE billing.accounts ADD COLUMN bonus_balance_micros bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT accounts_bonus_nonnegative CHECK (bonus_balance_micros >= 0);
-- 每条流水里赠送积分的变化量（加赠送为正、消耗赠送为负）；对账：账户赠送余额 = 本列合计。
ALTER TABLE billing.ledger_entries ADD COLUMN bonus_delta_micros bigint NOT NULL DEFAULT 0;
CREATE TABLE billing.membership_orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  client_order_id uuid NOT NULL,
  plan_id text NOT NULL,
  price_fen integer NOT NULL,
  list_price_fen integer NOT NULL,
  first_purchase boolean NOT NULL,
  bonus_points integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ledger_entry_id uuid,
  operator_user_id uuid,
  note text,
  created_at timestamptz NOT NULL,
  CONSTRAINT membership_orders_client_order_key UNIQUE (client_order_id),
  CONSTRAINT membership_orders_plan_check CHECK (plan_id IN ('month', 'quarter', 'year')),
  CONSTRAINT membership_orders_amounts_check CHECK (price_fen >= 0 AND list_price_fen >= 0 AND bonus_points >= 0)
);
-- 首次价每人限一次（任一档）。
CREATE UNIQUE INDEX membership_orders_first_purchase_key ON billing.membership_orders (user_id) WHERE first_purchase;
CREATE INDEX membership_orders_user_idx ON billing.membership_orders (user_id, created_at);
CREATE INDEX membership_orders_created_idx ON billing.membership_orders (created_at);
