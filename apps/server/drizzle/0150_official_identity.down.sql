-- 0150 回退：仅当没有 official 数据残留时才能回退（有残留直接失败，不删列、不丢数据）。
-- 残留包括：official_identity_key 非空的会话、kind='official' 的参与者、sender_kind='official' 的消息。
-- 回退后旧代码照常运行（官方会话功能随代码回退一起下线；开关与代码版本配套，见 docs/backend/official-assistant.md）。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "chat"."conversations" WHERE "official_identity_key" IS NOT NULL) THEN
    RAISE EXCEPTION '0150 回退被拒绝：仍有官方会话残留';
  END IF;
  IF EXISTS (SELECT 1 FROM "chat"."participants" WHERE "kind" = 'official') THEN
    RAISE EXCEPTION '0150 回退被拒绝：仍有官方参与者残留';
  END IF;
  IF EXISTS (SELECT 1 FROM "chat"."messages" WHERE "sender_kind" = 'official') THEN
    RAISE EXCEPTION '0150 回退被拒绝：仍有官方消息残留';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "chat"."messages" DROP CONSTRAINT "message_sender_kind";
--> statement-breakpoint
ALTER TABLE "chat"."messages" ADD CONSTRAINT "message_sender_kind" CHECK ("sender_kind" IN ('user', 'character', 'system'));
--> statement-breakpoint
ALTER TABLE "chat"."participants" DROP CONSTRAINT "participant_kind";
--> statement-breakpoint
ALTER TABLE "chat"."participants" ADD CONSTRAINT "participant_kind" CHECK ("kind" IN ('user', 'character'));
--> statement-breakpoint
DROP INDEX IF EXISTS "chat"."official_user_identity_idx";
--> statement-breakpoint
ALTER TABLE "chat"."conversations" DROP CONSTRAINT "conversation_official_direct";
--> statement-breakpoint
ALTER TABLE "chat"."conversations" DROP CONSTRAINT "conversation_official_identity";
--> statement-breakpoint
ALTER TABLE "chat"."conversations" DROP COLUMN "official_identity_key";
