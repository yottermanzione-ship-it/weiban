-- 0091 回退：删除稳定窗口、系统消息放法与稳定开头统计字段。
ALTER TABLE "model_access"."usage_records" DROP COLUMN IF EXISTS "stable_prefix_tokens";
--> statement-breakpoint
ALTER TABLE "model_access"."model_catalog" DROP CONSTRAINT IF EXISTS "model_catalog_system_message_mode";
--> statement-breakpoint
ALTER TABLE "model_access"."model_catalog" DROP COLUMN IF EXISTS "system_message_mode";
--> statement-breakpoint
ALTER TABLE "ai_runtime"."memory_states" DROP COLUMN IF EXISTS "window_block_ciphertext";
--> statement-breakpoint
ALTER TABLE "ai_runtime"."memory_states" DROP COLUMN IF EXISTS "window_start_seq";
