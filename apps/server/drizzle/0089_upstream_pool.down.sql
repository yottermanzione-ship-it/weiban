-- 0089 回退：删除路由表、设置表与上游账号池字段（模型目录的主路由仍在 model_catalog 上，不丢配置）。
DROP INDEX IF EXISTS "model_access"."usage_records_upstream_created_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "model_access"."settings";
--> statement-breakpoint
DROP TABLE IF EXISTS "model_access"."model_routes";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "last_used_at";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "last_error";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "consecutive_failures";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "cooldown_until";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "note";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "enabled";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "rpm_limit";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "max_concurrency";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "weight";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "priority";
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" DROP COLUMN IF EXISTS "provider";
