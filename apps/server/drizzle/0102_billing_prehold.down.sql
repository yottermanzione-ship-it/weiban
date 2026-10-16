-- 零费用hold属于真实历史，不能为回滚悄悄改成收费或删除；出现时由运维选择保留新schema。
DO $$ BEGIN IF EXISTS (SELECT 1 FROM billing.holds WHERE amount_micros = 0) THEN RAISE EXCEPTION 'Cannot rollback 0102 while zero-price holds exist; preserve history and keep schema'; END IF; END $$;
ALTER TABLE billing.holds DROP CONSTRAINT holds_amount_nonnegative, ADD CONSTRAINT holds_amount_positive CHECK (amount_micros > 0);
ALTER TABLE billing.accounts DROP COLUMN ecology_notice_pending, DROP COLUMN ecology_insufficient_since;
ALTER TABLE billing.holds DROP COLUMN settlement_snapshot, DROP COLUMN limit_snapshot;
