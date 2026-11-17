DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM billing.reward_daily_totals)
    OR EXISTS (SELECT 1 FROM billing.reward_days)
    OR EXISTS (SELECT 1 FROM billing.ad_revenue_reports) THEN
    RAISE EXCEPTION 'Reward or ad revenue data exists; retain the ledger and roll forward';
  END IF;
END $$;
DROP TABLE IF EXISTS billing.reward_daily_totals;
DROP TABLE billing.ad_revenue_reports;
DROP TABLE billing.reward_days;
