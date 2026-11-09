-- 2026-11-09：所有用户重新获得月/季/年各一次首次价；保留历史实收价与订单。
ALTER TABLE billing.membership_orders
  ADD COLUMN first_purchase_campaign text NOT NULL DEFAULT 'legacy';

DROP INDEX billing.membership_orders_first_purchase_key;
CREATE UNIQUE INDEX membership_orders_first_purchase_key
  ON billing.membership_orders (user_id, plan_id, first_purchase_campaign)
  WHERE first_purchase;
