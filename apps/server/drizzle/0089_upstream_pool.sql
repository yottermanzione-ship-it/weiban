-- 0089_upstream_pool.sql（ADR-0032 第二批：上游账号池与用量监控）
-- 1) model_access.upstreams：一行 = 一个上游账号（同一服务商可多行），加调度与健康字段。
-- 2) model_access.model_routes：模型 → 多个账号（优先级、权重）；把旧目录的单一上游迁为第一条路由。
-- 3) model_access.settings：每用户限流与健康参数（键 gateway_limits）。
-- 4) usage_records 按上游 + 时间的索引（按账号统计）。
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "provider" text;
--> statement-breakpoint
UPDATE "model_access"."upstreams" SET "provider" = "kind" WHERE "provider" IS NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ALTER COLUMN "provider" SET DEFAULT 'openai_compatible';
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ALTER COLUMN "provider" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "weight" integer DEFAULT 100 NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "max_concurrency" integer;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "rpm_limit" integer;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "note" text;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "cooldown_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "last_error" text;
--> statement-breakpoint
ALTER TABLE "model_access"."upstreams" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_access"."model_routes" (
  "model_key" text NOT NULL,
  "upstream_id" uuid NOT NULL REFERENCES "model_access"."upstreams"("id") ON DELETE CASCADE,
  "upstream_model_id" text NOT NULL,
  "priority" integer DEFAULT 1 NOT NULL,
  "weight" integer DEFAULT 100 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "model_routes_pkey" PRIMARY KEY ("model_key", "upstream_id"),
  CONSTRAINT "model_routes_weight_check" CHECK ("weight" >= 1 AND "priority" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_routes_upstream_idx" ON "model_access"."model_routes" ("upstream_id");
--> statement-breakpoint
INSERT INTO "model_access"."model_routes"
  ("model_key", "upstream_id", "upstream_model_id", "priority", "weight", "enabled", "created_at", "updated_at")
SELECT c."model_key", c."upstream_id", c."upstream_model_id", 1, 100, true, now(), now()
  FROM "model_access"."model_catalog" c
  JOIN "model_access"."upstreams" u ON u."id" = c."upstream_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_access"."settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_records_upstream_created_idx" ON "model_access"."usage_records" ("upstream_id", "created_at");
