-- 10-20 批 E3（契约 3.22）：模型限时折扣。只作用于售价（成本不变）；冻结时锁定折扣，结算按冻结时的折扣。
CREATE TABLE billing.model_discounts (
  model_key text PRIMARY KEY,
  -- 折扣系数 × 10000（5000 = 5 折）
  rate_bp integer NOT NULL CHECK (rate_bp BETWEEN 100 AND 9900),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid,
  CONSTRAINT model_discounts_window CHECK (ends_at > starts_at)
);
-- 冻结时的折扣（10000 = 原价）；结算按它算，避免折扣在调用中途到期导致冻结与扣费口径不一致。
ALTER TABLE billing.holds ADD COLUMN discount_bp integer NOT NULL DEFAULT 10000
  CHECK (discount_bp BETWEEN 100 AND 10000);
