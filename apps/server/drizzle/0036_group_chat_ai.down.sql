-- rollback for 0036_group_chat_ai.sql
DROP TABLE IF EXISTS "ai_runtime"."group_invites";
DROP TABLE IF EXISTS "ai_runtime"."group_self_chats";
DROP TABLE IF EXISTS "ai_runtime"."group_companion_settings";
