-- 有待核风险时不可丢弃其来源或占用；先按证据结清再回滚。
DO $$ BEGIN IF EXISTS (SELECT 1 FROM billing.platform_daily_budget WHERE uncertain_cost_micros > 0) OR EXISTS (SELECT 1 FROM billing.holds WHERE risk_snapshot->>'phase' IN ('sent','unknown')) THEN RAISE EXCEPTION 'Cannot rollback 0102 while sent/unknown call risks remain'; END IF; END $$;
-- 零费用hold属于真实历史，不能为回滚悄悄改成收费或删除；出现时由运维选择保留新schema。
DO $$ BEGIN IF EXISTS (SELECT 1 FROM billing.holds WHERE amount_micros = 0) THEN RAISE EXCEPTION 'Cannot rollback 0102 while zero-price holds exist; preserve history and keep schema'; END IF; END $$;
ALTER TABLE billing.holds DROP CONSTRAINT holds_amount_nonnegative, ADD CONSTRAINT holds_amount_positive CHECK (amount_micros > 0);
ALTER TABLE billing.accounts DROP COLUMN ecology_notice_pending, DROP COLUMN ecology_insufficient_since;
ALTER TABLE billing.holds DROP COLUMN settlement_snapshot, DROP COLUMN release_snapshot, DROP COLUMN risk_snapshot, DROP COLUMN limit_snapshot;
ALTER TABLE billing.platform_daily_budget DROP CONSTRAINT platform_daily_budget_uncertain_nonnegative, DROP COLUMN uncertain_cost_micros;
