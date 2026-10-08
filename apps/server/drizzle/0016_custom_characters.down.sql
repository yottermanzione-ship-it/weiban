DROP INDEX IF EXISTS "characters"."characters_custom_owner_idx";
ALTER TABLE "characters"."characters" DROP CONSTRAINT IF EXISTS "custom_has_owner";
ALTER TABLE "characters"."characters" DROP COLUMN IF EXISTS "trial_conversation_id";
