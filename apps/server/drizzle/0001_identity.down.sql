-- 回滚 0001_identity：删除账号模块的全部表和 identity schema。
-- 注意：会删掉所有账号、会话、资料、设置和邀请码。只用于开发 / 测试库；生产环境回滚前必须先备份。
DROP TABLE IF EXISTS "identity"."deletion_progress";
DROP TABLE IF EXISTS "identity"."login_throttle";
DROP TABLE IF EXISTS "identity"."invites";
DROP TABLE IF EXISTS "identity"."sessions";
DROP TABLE IF EXISTS "identity"."preferences";
DROP TABLE IF EXISTS "identity"."notification_settings";
DROP TABLE IF EXISTS "identity"."profiles";
DROP TABLE IF EXISTS "identity"."users";
DROP SCHEMA IF EXISTS "identity";
