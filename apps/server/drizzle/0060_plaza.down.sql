-- 0060_plaza.down.sql
DROP TABLE IF EXISTS "plaza"."adoptions";
DROP TABLE IF EXISTS "plaza"."publish_drafts";
DROP TABLE IF EXISTS "plaza"."work_versions";
DROP FUNCTION IF EXISTS "plaza"."work_versions_append_only"();
DROP TABLE IF EXISTS "plaza"."works";
DROP TABLE IF EXISTS "plaza"."bans";
DROP TABLE IF EXISTS "plaza"."author_profiles";
DROP SCHEMA IF EXISTS "plaza";
