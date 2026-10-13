-- 0088 回退：删除计费配置表与消息上的扣费字段。
DROP INDEX IF EXISTS "chat"."message_usage_record_idx";
--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP COLUMN IF EXISTS "usage_record_id";
--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP COLUMN IF EXISTS "charged_micros";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing"."settings";
