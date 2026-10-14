-- 回滚 0092：注意会丢失反馈 / 投诉数据；仍在冻结中的服务费需先在后台处理完（否则 held_micros 与冻结记录对不上）。
DROP TABLE IF EXISTS "support"."tickets";
--> statement-breakpoint
DROP SCHEMA IF EXISTS "support";
--> statement-breakpoint
DROP INDEX IF EXISTS "plaza"."role_requests_fee_idx";
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" DROP CONSTRAINT IF EXISTS "role_request_fee_state";
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" DROP COLUMN IF EXISTS "fee_state";
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" DROP COLUMN IF EXISTS "fee_hold_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "billing"."fee_holds";
