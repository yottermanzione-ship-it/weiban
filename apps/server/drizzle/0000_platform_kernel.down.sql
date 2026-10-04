-- 回滚 0000_platform_kernel：删除平台内核的全部表和 platform schema。
-- 注意：会删掉发件箱、收件箱、审计日志和数据密钥（数据密钥删了，用它加密的数据就再也解不开）。
-- 只用于开发 / 测试库；生产环境回滚前必须先备份。
DROP TABLE IF EXISTS "platform"."user_data_keys";
DROP TABLE IF EXISTS "platform"."outbox";
DROP TABLE IF EXISTS "platform"."event_inbox";
DROP TABLE IF EXISTS "platform"."audit_log";
DROP SCHEMA IF EXISTS "platform";
