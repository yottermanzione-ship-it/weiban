-- 0035_new_friends.down.sql
DROP TABLE IF EXISTS "contacts"."new_friend_state";
ALTER TABLE "contacts"."contacts" DROP COLUMN IF EXISTS "new_friend_hidden_at";
ALTER TABLE "contacts"."card_recommendations" DROP COLUMN IF EXISTS "hidden_at";
