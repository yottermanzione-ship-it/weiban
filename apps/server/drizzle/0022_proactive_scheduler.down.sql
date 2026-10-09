-- rollback for 0022_proactive_scheduler.sql
DROP TABLE IF EXISTS "ai_runtime"."user_chat_activity";
DROP TABLE IF EXISTS "ai_runtime"."proactive_plans";
