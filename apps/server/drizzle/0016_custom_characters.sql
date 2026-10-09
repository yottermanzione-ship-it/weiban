-- 0016_custom_characters.sql
-- T-047: 用户自定义角色创建支持（CHR-07）：
--   1. characters.custom_description：存放用户填写的人设描述（已加密存入 draft_ciphertext，
--      本列只保留 ≥50 字的原始长度，供规则层儿童特征检测需要的上下文长度断言，不存明文）
--      ——实际上描述已在 draft_ciphertext 中，本迁移不需要新列来存长度。
--   2. characters.trial_conversation_id：试聊会话 ID（nullable），
--      试聊结束后设为 NULL 触发清理任务；实际清理由 contacts 侧的软删与
--      ai-runtime lifecycle 完成，这里只需要字段存在。
--   3. 允许 kind='custom' 的行拥有 status='active'（现有 CHECK 已允许）。
--   4. 新增 CHECK 约束：kind='custom' 时 owner_id 不为 NULL。
-- statement-breakpoint
ALTER TABLE "characters"."characters"
  ADD COLUMN "trial_conversation_id" uuid;
-- statement-breakpoint
ALTER TABLE "characters"."characters"
  ADD CONSTRAINT "custom_has_owner"
    CHECK (
      "kind" <> 'custom' OR "owner_id" IS NOT NULL
    );
-- statement-breakpoint
CREATE INDEX "characters_custom_owner_idx"
  ON "characters"."characters" USING btree ("owner_id", "kind");
