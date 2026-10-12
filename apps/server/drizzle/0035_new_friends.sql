-- 0035_new_friends.sql
-- L4 收尾：「新的朋友」列表（名片推荐与好友申请记录），删除记录、已看过在服务器保存，多设备同步。
-- statement-breakpoint
ALTER TABLE "contacts"."card_recommendations" ADD COLUMN "hidden_at" timestamptz;
-- statement-breakpoint
ALTER TABLE "contacts"."contacts" ADD COLUMN "new_friend_hidden_at" timestamptz;
-- statement-breakpoint
CREATE TABLE "contacts"."new_friend_state" (
  "user_id"  uuid        PRIMARY KEY,
  "seen_at"  timestamptz NOT NULL
);
