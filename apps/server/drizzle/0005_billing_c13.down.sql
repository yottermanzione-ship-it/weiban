CREATE OR REPLACE FUNCTION "billing"."purge_user_account"(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid;
  v_rows integer := 0;
  v_n integer;
BEGIN
  SELECT id INTO v_account FROM billing.accounts WHERE user_id = p_user_id FOR UPDATE;
  IF v_account IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM set_config('billing.ledger_purge', 'on', true);
  DELETE FROM billing.ledger_entries WHERE account_id = v_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  PERFORM set_config('billing.ledger_purge', 'off', true);
  DELETE FROM billing.holds WHERE account_id = v_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM billing.daily_spend WHERE account_id = v_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  DELETE FROM billing.accounts WHERE id = v_account;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rows := v_rows + v_n;
  RETURN v_rows;
END;
$$;
DROP INDEX "billing"."ledger_entries_usage_record_idx";
ALTER TABLE "billing"."reconciliation_runs" DROP COLUMN "usage_amount_mismatch";
ALTER TABLE "billing"."reconciliation_runs" DROP COLUMN "usage_reconciled_at";
