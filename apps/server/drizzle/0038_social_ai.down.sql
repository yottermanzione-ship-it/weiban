-- rollback for 0038_social_ai.sql
DROP TABLE IF EXISTS "ai_runtime"."card_referrals";
DROP TABLE IF EXISTS "ai_runtime"."moments_plans";
DROP TABLE IF EXISTS "ai_runtime"."joint_events";
DROP TABLE IF EXISTS "ai_runtime"."chat_visits";
DROP TABLE IF EXISTS "ai_runtime"."memory_sharing_settings";
