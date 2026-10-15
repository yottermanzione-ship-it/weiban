CREATE TABLE IF NOT EXISTS "chat"."forward_receipts" (
  "user_id" uuid NOT NULL,
  "request_id" uuid NOT NULL,
  "target_id" uuid NOT NULL REFERENCES "chat"."conversations"("id") ON DELETE CASCADE,
  "fingerprint" text NOT NULL,
  "message_ids" uuid[] NOT NULL,
  PRIMARY KEY ("user_id", "request_id", "target_id")
);
