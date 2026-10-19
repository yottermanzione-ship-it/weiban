DROP TABLE IF EXISTS billing.membership_orders;
ALTER TABLE billing.ledger_entries DROP COLUMN IF EXISTS bonus_delta_micros;
ALTER TABLE billing.accounts DROP CONSTRAINT IF EXISTS accounts_bonus_nonnegative, DROP COLUMN IF EXISTS bonus_balance_micros;
