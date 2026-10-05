-- 回滚 0002_billing：删除计费模块的全部表、触发器、函数和 billing schema。
-- 注意：会删掉所有钱包、流水、冻结、价目表和对账记录。只用于开发 / 测试库；生产环境回滚前必须先备份。
DROP TRIGGER IF EXISTS "ledger_entries_no_truncate" ON "billing"."ledger_entries";
DROP TRIGGER IF EXISTS "ledger_entries_no_update_delete" ON "billing"."ledger_entries";
DROP FUNCTION IF EXISTS "billing"."purge_user_account"(uuid);
DROP FUNCTION IF EXISTS "billing"."ledger_entries_append_only"();
DROP TABLE IF EXISTS "billing"."reconciliation_runs";
DROP TABLE IF EXISTS "billing"."upstream_bills";
DROP TABLE IF EXISTS "billing"."price_items";
DROP TABLE IF EXISTS "billing"."price_versions";
DROP TABLE IF EXISTS "billing"."platform_daily_budget";
DROP TABLE IF EXISTS "billing"."daily_spend";
DROP TABLE IF EXISTS "billing"."holds";
DROP TABLE IF EXISTS "billing"."ledger_entries";
DROP TABLE IF EXISTS "billing"."accounts";
DROP SCHEMA IF EXISTS "billing";
