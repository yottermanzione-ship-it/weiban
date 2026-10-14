-- 0091_chat_pipeline.sql（docs/refactor/09-chat-pipeline.md）
-- 1. 分段稳定窗口：记忆状态加摘要边界与冻结的稳定记忆块；
-- 2. 模型目录加「系统消息放法」；
-- 3. 用量记录加「稳定开头估算 token」，用于理论可缓存占比统计。
--> statement-breakpoint
ALTER TABLE "ai_runtime"."memory_states" ADD COLUMN IF NOT EXISTS "window_start_seq" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_runtime"."memory_states" ADD COLUMN IF NOT EXISTS "window_block_ciphertext" bytea;
--> statement-breakpoint
ALTER TABLE "model_access"."model_catalog" ADD COLUMN IF NOT EXISTS "system_message_mode" text DEFAULT 'multi' NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."model_catalog" DROP CONSTRAINT IF EXISTS "model_catalog_system_message_mode";
--> statement-breakpoint
ALTER TABLE "model_access"."model_catalog" ADD CONSTRAINT "model_catalog_system_message_mode" CHECK ("system_message_mode" IN ('multi','single_system','no_system'));
--> statement-breakpoint
ALTER TABLE "model_access"."usage_records" ADD COLUMN IF NOT EXISTS "stable_prefix_tokens" integer;
