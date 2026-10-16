ALTER TABLE billing.holds ADD COLUMN risk_snapshot jsonb, ADD COLUMN limit_snapshot jsonb, ADD COLUMN settlement_snapshot jsonb, ADD COLUMN release_snapshot jsonb;
ALTER TABLE billing.accounts ADD COLUMN ecology_insufficient_since timestamptz, ADD COLUMN ecology_notice_pending boolean NOT NULL DEFAULT false;
ALTER TABLE billing.holds DROP CONSTRAINT holds_amount_positive, ADD CONSTRAINT holds_amount_nonnegative CHECK (amount_micros >= 0);
ALTER TABLE billing.platform_daily_budget ADD COLUMN uncertain_cost_micros bigint NOT NULL DEFAULT 0, ADD CONSTRAINT platform_daily_budget_uncertain_nonnegative CHECK (uncertain_cost_micros >= 0);
