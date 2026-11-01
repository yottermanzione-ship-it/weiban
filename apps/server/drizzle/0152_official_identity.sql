-- 0152 小V同学官方身份（方向 B）：官方会话标记列 + 参与者/消息 sender 检查扩展。
-- 手写迁移（本仓库 0015 起的惯例：只写增量 SQL，不重新生成快照；见 drizzle.config.ts 注释）。
-- 可逆：回退见同名 .down.sql（删列 + 检查恢复旧值）。执行前须停 worker（新代码依赖新检查），
-- 回退前须确认没有 official 会话/消息残留（down 脚本先断言，残留时直接失败、不删列）。
-- 绝不在现网库手动执行：只随发布走迁移器（src/cli/migrate.ts up）。

-- 1) conversations 加官方标记列（NULL = 普通会话；'official:xiaov' = 小V同学官方会话）。
ALTER TABLE "chat"."conversations" ADD COLUMN "official_identity_key" text;
--> statement-breakpoint
-- 2) 官方标记只能取固定值。
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversation_official_identity" CHECK ("official_identity_key" IS NULL OR "official_identity_key" = 'official:xiaov');
--> statement-breakpoint
-- 3) 官方会话一定是 direct 且不挂角色（群聊、朋友圈里不出现官方身份）。
ALTER TABLE "chat"."conversations" ADD CONSTRAINT "conversation_official_direct" CHECK ("official_identity_key" IS NULL OR ("type" = 'direct' AND "character_id" IS NULL));
--> statement-breakpoint
-- 4) 每用户最多一个官方会话（部分唯一索引；NULL 行不参与，普通会话不受影响）。
CREATE UNIQUE INDEX "official_user_identity_idx" ON "chat"."conversations" ("owner_user_id", "official_identity_key") WHERE "official_identity_key" IS NOT NULL;
--> statement-breakpoint
-- 5) 参与者 kind 加 'official'（官方参与者 refId 为固定键 OFFICIAL_REF_ID，不是角色 ID）。
ALTER TABLE "chat"."participants" DROP CONSTRAINT "participant_kind";
--> statement-breakpoint
ALTER TABLE "chat"."participants" ADD CONSTRAINT "participant_kind" CHECK ("kind" IN ('user', 'character', 'official'));
--> statement-breakpoint
-- 6) 消息 sender_kind 加 'official'（'system' 仍是系统提示，不得挪用为官方身份）。
ALTER TABLE "chat"."messages" DROP CONSTRAINT "message_sender_kind";
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "message_sender_kind" CHECK ("sender_kind" IN ('user', 'character', 'system', 'official'));
