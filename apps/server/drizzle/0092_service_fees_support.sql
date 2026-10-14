-- 0092_service_fees_support.sql（总经理 10-14 总对照表 Q5、Q9，契约 3.8）
-- 1) billing.fee_holds：固定金额的服务费冻结（BillingServiceFeePort），不过期，计入 accounts.held_micros。
-- 2) plaza.role_requests：申请制作扣积分（冻结 ID、冻结状态）；申请制作价格默认 200 积分（已有配置为 0 的改为 200）。
-- 3) support.tickets：帮助与反馈、投诉。
CREATE TABLE IF NOT EXISTS "billing"."fee_holds" (
  "id"               uuid        PRIMARY KEY,
  "account_id"       uuid        NOT NULL REFERENCES "billing"."accounts"("id") ON DELETE CASCADE,
  "kind"             text        NOT NULL,
  "amount_micros"    bigint      NOT NULL,
  "idempotency_key"  text        NOT NULL,
  "note"             text        NOT NULL,
  "status"           text        NOT NULL,
  "created_at"       timestamptz NOT NULL,
  "closed_at"        timestamptz,
  "ledger_entry_id"  uuid,
  CONSTRAINT "fee_holds_status_check" CHECK ("status" IN ('active', 'settled', 'released')),
  CONSTRAINT "fee_holds_amount_positive" CHECK ("amount_micros" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fee_holds_idempotency_key_key" ON "billing"."fee_holds" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fee_holds_account_status_idx" ON "billing"."fee_holds" ("account_id", "status");
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" ADD COLUMN IF NOT EXISTS "fee_hold_id" uuid;
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" ADD COLUMN IF NOT EXISTS "fee_state" text NOT NULL DEFAULT 'none';
--> statement-breakpoint
ALTER TABLE "plaza"."role_requests" ADD CONSTRAINT "role_request_fee_state" CHECK ("fee_state" IN ('none', 'held', 'settled', 'released'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_requests_fee_idx" ON "plaza"."role_requests" ("fee_state");
--> statement-breakpoint
UPDATE "plaza"."settings"
   SET "value" = jsonb_set("value", '{pointsCost}', '200'::jsonb), "updated_at" = now()
 WHERE "key" = 'role_request_config' AND coalesce(("value"->>'pointsCost')::int, 0) = 0;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "support";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support"."tickets" (
  "id"                 uuid        PRIMARY KEY,
  "user_id"            uuid        NOT NULL,
  "client_request_id"  uuid        NOT NULL,
  "kind"               text        NOT NULL,
  "category"           text,
  "target_type"        text,
  "target_id"          uuid,
  "reason"             text,
  "text"               text        NOT NULL,
  "media_ids"          uuid[]      NOT NULL DEFAULT '{}',
  "conversation_id"    uuid,
  "character_id"       uuid,
  "status"             text        NOT NULL DEFAULT 'open',
  "replies"            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "user_unseen"        boolean     NOT NULL DEFAULT false,
  "handled_by"         uuid,
  "created_at"         timestamptz NOT NULL,
  "updated_at"         timestamptz NOT NULL,
  "resolved_at"        timestamptz,
  CONSTRAINT "ticket_kind" CHECK ("kind" IN ('feedback', 'complaint')),
  CONSTRAINT "ticket_status" CHECK ("status" IN ('open', 'replied', 'resolved')),
  CONSTRAINT "ticket_text_len" CHECK (char_length("text") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_client_idx" ON "support"."tickets" ("user_id", "client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_user_idx" ON "support"."tickets" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_status_idx" ON "support"."tickets" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tickets_target_idx" ON "support"."tickets" ("target_id");
