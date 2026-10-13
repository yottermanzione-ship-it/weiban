-- 0088_points_rates.sql（ADR-0032 积分制，第一批）
-- 1) billing.settings：计费的后台配置（键值），首个键 recharge_options = 充值档位、赠送比例、联系管理员说明。
-- 2) chat.messages：记下生成这条消息消耗的金额与调用（Message.pointsCost / usageRecordId，积分明细按调用查消息摘要）。
-- 模型倍率不建新表：倍率就是当前生效价目表里该模型的输入 / 缓存 / 输出全天价（billing.price_items），旧数据原样沿用。
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing"."settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN IF NOT EXISTS "charged_micros" bigint;
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD COLUMN IF NOT EXISTS "usage_record_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_usage_record_idx" ON "chat"."messages" ("usage_record_id") WHERE "usage_record_id" IS NOT NULL;
