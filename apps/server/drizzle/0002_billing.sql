CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TABLE "billing"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"balance_micros" bigint NOT NULL,
	"held_micros" bigint NOT NULL,
	"low_balance_threshold_micros" bigint NOT NULL,
	"background_daily_limit_micros" bigint NOT NULL,
	"time_zone" text NOT NULL,
	"insufficient_since" timestamp with time zone,
	"low_notified_on" date,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "accounts_kind_check" CHECK ("billing"."accounts"."kind" in ('user', 'platform')),
	CONSTRAINT "accounts_owner_check" CHECK (("billing"."accounts"."kind" = 'user' and "billing"."accounts"."user_id" is not null) or ("billing"."accounts"."kind" = 'platform' and "billing"."accounts"."user_id" is null)),
	CONSTRAINT "accounts_held_nonnegative" CHECK ("billing"."accounts"."held_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing"."daily_spend" (
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"background_settled_micros" bigint NOT NULL,
	"total_charged_micros" bigint NOT NULL,
	CONSTRAINT "daily_spend_account_id_day_pk" PRIMARY KEY("account_id","day")
);
--> statement-breakpoint
CREATE TABLE "billing"."holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_micros" bigint NOT NULL,
	"purpose" text NOT NULL,
	"model_key" text NOT NULL,
	"character_id" uuid,
	"idempotency_key" text NOT NULL,
	"price_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"budget_day" date NOT NULL,
	"reserved_cost_micros" bigint NOT NULL,
	"counts_as_background" boolean NOT NULL,
	"background_day" date,
	"safety_overdraft" boolean NOT NULL,
	"closed_at" timestamp with time zone,
	"ledger_entry_id" uuid,
	"release_reason" text,
	"absorbed_cost_micros" bigint,
	CONSTRAINT "holds_status_check" CHECK ("billing"."holds"."status" in ('active', 'settled', 'released', 'expired')),
	CONSTRAINT "holds_amount_positive" CHECK ("billing"."holds"."amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing"."ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"balance_after_micros" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"usage_record_id" uuid,
	"hold_id" uuid,
	"purpose" text,
	"model_key" text,
	"character_id" uuid,
	"price_version_id" uuid,
	"upstream_id" uuid,
	"cost_micros" bigint,
	"absorbed" boolean NOT NULL,
	"safety_overdraft" boolean NOT NULL,
	"reason" text,
	"operator_user_id" uuid,
	CONSTRAINT "ledger_entries_type_check" CHECK ("billing"."ledger_entries"."type" in ('admin_grant', 'admin_deduct', 'charge', 'refund', 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "billing"."platform_daily_budget" (
	"budget_day" date PRIMARY KEY NOT NULL,
	"cap_micros" bigint NOT NULL,
	"settled_cost_micros" bigint NOT NULL,
	"reserved_cost_micros" bigint NOT NULL,
	"alert_sent_at" timestamp with time zone,
	CONSTRAINT "platform_daily_budget_reserved_nonnegative" CHECK ("billing"."platform_daily_budget"."reserved_cost_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing"."price_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"price_version_id" uuid NOT NULL,
	"model_key" text NOT NULL,
	"unit" text NOT NULL,
	"band" jsonb,
	"price_micros" bigint NOT NULL,
	"cost_micros" bigint NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."price_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"version_label" text NOT NULL,
	"status" text NOT NULL,
	"effective_from" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"retired_at" timestamp with time zone,
	CONSTRAINT "price_versions_status_check" CHECK ("billing"."price_versions"."status" in ('draft', 'active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"ledger_consistent" boolean NOT NULL,
	"stale_holds" integer NOT NULL,
	"usage_without_charge" integer NOT NULL,
	"charge_without_usage" integer NOT NULL,
	"upstream_diffs" jsonb NOT NULL,
	"absorbed_micros" bigint NOT NULL,
	"details" jsonb NOT NULL,
	"diff_ratio_threshold" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."upstream_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upstream_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_micros" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "billing"."daily_spend" ADD CONSTRAINT "daily_spend_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."holds" ADD CONSTRAINT "holds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "billing"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."price_items" ADD CONSTRAINT "price_items_price_version_id_price_versions_id_fk" FOREIGN KEY ("price_version_id") REFERENCES "billing"."price_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_id_key" ON "billing"."accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_single_platform_key" ON "billing"."accounts" USING btree ("kind") WHERE "billing"."accounts"."kind" = 'platform';--> statement-breakpoint
CREATE UNIQUE INDEX "holds_idempotency_key_key" ON "billing"."holds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "holds_account_status_idx" ON "billing"."holds" USING btree ("account_id","status");--> statement-breakpoint
CREATE INDEX "holds_active_expires_idx" ON "billing"."holds" USING btree ("expires_at") WHERE "billing"."holds"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "billing"."ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_usage_charge_key" ON "billing"."ledger_entries" USING btree ("usage_record_id") WHERE "billing"."ledger_entries"."type" = 'charge' and "billing"."ledger_entries"."absorbed" = false;--> statement-breakpoint
CREATE INDEX "ledger_entries_account_created_idx" ON "billing"."ledger_entries" USING btree ("account_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_idx" ON "billing"."ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_items_version_model_idx" ON "billing"."price_items" USING btree ("price_version_id","model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "price_versions_single_active_key" ON "billing"."price_versions" USING btree ("status") WHERE "billing"."price_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_run_date_key" ON "billing"."reconciliation_runs" USING btree ("run_date");--> statement-breakpoint
CREATE INDEX "upstream_bills_period_idx" ON "billing"."upstream_bills" USING btree ("period_end");
--> statement-breakpoint
-- ---------- 以下为手写（T-023）：流水只增不改（billing.md 5.2 第 2 条） ----------
-- 应用和迁移使用同一个数据库账号（表的所有者），单靠 REVOKE 拦不住所有者，所以用触发器在数据库层面拒绝
-- UPDATE / DELETE / TRUNCATE。唯一例外：注销账号的删除清单调用 billing.purge_user_account()，
-- 它在函数内部临时打开事务级开关 billing.ledger_purge 后物理删除该用户的流水（billing.md 第 11 节）。
REVOKE UPDATE, DELETE, TRUNCATE ON "billing"."ledger_entries" FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION "billing"."ledger_entries_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('billing.ledger_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'billing.ledger_entries 只增不改：禁止 %（改错请追加 adjustment 流水）', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_update_delete"
  BEFORE UPDATE OR DELETE ON "billing"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "billing"."ledger_entries_append_only"();
--> statement-breakpoint
CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "billing"."ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION "billing"."ledger_entries_append_only"();
--> statement-breakpoint
-- 注销删除清单：物理删除某用户的钱包、流水、冻结、每日汇总，返回删除的行数。可重复调用（第二次返回 0）。
CREATE FUNCTION "billing"."purge_user_account"(p_user_id uuid) RETURNS integer
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