-- 0030_chat_groups.down.sql
ALTER TABLE "chat"."messages"
  DROP CONSTRAINT IF EXISTS "message_action_pair",
  DROP COLUMN IF EXISTS "action_chosen_at",
  DROP COLUMN IF EXISTS "action_id",
  DROP COLUMN IF EXISTS "content_type";
DROP INDEX IF EXISTS "chat"."participants_ref_idx";
ALTER TABLE "chat"."participants" DROP COLUMN IF EXISTS "left_at";
DROP INDEX IF EXISTS "chat"."conversations_owner_type_idx";
DROP INDEX IF EXISTS "chat"."conversations_create_key_idx";
ALTER TABLE "chat"."conversations"
  DROP COLUMN IF EXISTS "create_key",
  DROP COLUMN IF EXISTS "title_customized",
  DROP COLUMN IF EXISTS "created_by_character_id";
