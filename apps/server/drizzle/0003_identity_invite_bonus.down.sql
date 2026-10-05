-- 回滚 0003_identity_invite_bonus：去掉邀请码的注册赠送金额、账号的「重新触发删除」时间。
-- 注意：已设置的赠送金额会丢失。只用于开发 / 测试库；生产环境回滚前必须先备份。
ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "deletion_retriggered_at";
ALTER TABLE "identity"."invites" DROP COLUMN IF EXISTS "bonus_micros";
