-- 0021_proactive.down.sql
-- 回滚 0021_proactive.sql（T-052 proactive 模块）。
DROP TABLE IF EXISTS "proactive"."proactive_pending_reply";
DROP TABLE IF EXISTS "proactive"."proactive_sent_log";
DROP TABLE IF EXISTS "proactive"."daily_events";
DROP TABLE IF EXISTS "proactive"."holidays";
DROP SCHEMA IF EXISTS "proactive";
