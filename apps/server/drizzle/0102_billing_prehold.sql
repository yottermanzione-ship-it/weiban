ALTER TABLE billing.holds ADD COLUMN limit_snapshot jsonb, ADD COLUMN settlement_snapshot jsonb;
ALTER TABLE billing.accounts ADD COLUMN ecology_insufficient_since timestamptz, ADD COLUMN ecology_notice_pending boolean NOT NULL DEFAULT false;
ALTER TABLE billing.holds DROP CONSTRAINT holds_amount_positive, ADD CONSTRAINT holds_amount_nonnegative CHECK (amount_micros >= 0);
