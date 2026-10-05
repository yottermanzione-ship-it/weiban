ALTER TABLE "billing"."reconciliation_runs" ADD COLUMN "usage_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_runs" ADD COLUMN "usage_amount_mismatch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_entries_usage_record_idx" ON "billing"."ledger_entries" USING btree ("usage_record_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "billing"."purge_user_account"(p_user_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_account uuid;
  v_rows integer := 0;
  v_n integer;
  v_budget record;
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
  -- Q-011: return the active reservations before deleting their source rows.
  -- Lock budget days in a deterministic order, after the account lock.
  FOR v_budget IN
    SELECT budget_day, sum(reserved_cost_micros) AS reserved
      FROM billing.holds WHERE account_id = v_account AND status = 'active'
      GROUP BY budget_day ORDER BY budget_day
  LOOP
    UPDATE billing.platform_daily_budget
      SET reserved_cost_micros = GREATEST(reserved_cost_micros - v_budget.reserved, 0)
      WHERE budget_day = v_budget.budget_day;
  END LOOP;
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
