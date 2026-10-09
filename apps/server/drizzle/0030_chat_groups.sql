-- 0030_chat_groups.sql
-- T-063 群聊（SOC-03、SOC-06）、消息卡片按钮（ADR-0026）、按内容类型读取（ReadMessagesInput.contentTypes）。
-- 群会话沿用 chat.conversations（type = 'group'），成员沿用 chat.participants。
-- statement-breakpoint
ALTER TABLE "chat"."conversations"
  ADD COLUMN "created_by_character_id" uuid,
  ADD COLUMN "title_customized" boolean NOT NULL DEFAULT false,
  ADD COLUMN "create_key" text;
-- statement-breakpoint
-- 建群幂等：同一用户同一 clientRequestId / 幂等键只建一个群。
CREATE UNIQUE INDEX "conversations_create_key_idx"
  ON "chat"."conversations" ("owner_user_id", "create_key")
  WHERE "create_key" IS NOT NULL;
-- statement-breakpoint
CREATE INDEX "conversations_owner_type_idx" ON "chat"."conversations" ("owner_user_id", "type");
-- statement-breakpoint
-- 退出 / 被移出的成员保留参与者行（历史消息的发送者仍可渲染），left_at 不为空即不是成员。
ALTER TABLE "chat"."participants" ADD COLUMN "left_at" timestamptz;
-- statement-breakpoint
CREATE INDEX "participants_ref_idx" ON "chat"."participants" ("kind", "ref_id");
-- statement-breakpoint
-- content_type：写入时记录明文类型（正文仍加密），供 contentTypes 过滤与搜索；旧消息为 NULL，读取时解密后再判断。
-- action_id / action_chosen_at：action_card 消息上用户的选择，只能写一次。
ALTER TABLE "chat"."messages"
  ADD COLUMN "content_type" text,
  ADD COLUMN "action_id" text,
  ADD COLUMN "action_chosen_at" timestamptz,
  ADD CONSTRAINT "message_action_pair" CHECK (("action_id" IS NULL) = ("action_chosen_at" IS NULL));
