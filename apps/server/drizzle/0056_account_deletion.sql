-- 0056_account_deletion.sql
-- T-080 注销完整流程（ACC-06、ADM-10，security-and-privacy.md 第 5.1 节）：
-- 1. identity.users.deletion_rechecks：所有模块回报后先逐模块复核剩余条数，有残留则重新投递，
--    这里记复核轮数（超过上限后停在「注销未完成」，交管理员重新触发）。
-- 2. plaza.adoptions.author_deleted_at：作者注销后其作品被物理删除，别人复制 / 应用的角色
--    仍要显示来源作者「已注销用户」（PLZ-06 第 4 条），在采用记录上留标记（不含作者任何信息）。
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "deletion_rechecks" integer NOT NULL DEFAULT 0;
-- statement-breakpoint
ALTER TABLE "plaza"."adoptions" ADD COLUMN IF NOT EXISTS "author_deleted_at" timestamp with time zone;
