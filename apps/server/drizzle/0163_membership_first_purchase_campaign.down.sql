-- 新规则已有订单时，旧的每人一次约束无法无损恢复；拒绝回滚，不篡改历史订单。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM billing.membership_orders WHERE first_purchase GROUP BY user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot restore global first-purchase rule after per-plan orders; roll forward';
  END IF;
END $$;
DROP INDEX billing.membership_orders_first_purchase_key;
CREATE UNIQUE INDEX membership_orders_first_purchase_key
  ON billing.membership_orders (user_id) WHERE first_purchase;
ALTER TABLE billing.membership_orders DROP COLUMN first_purchase_campaign;
