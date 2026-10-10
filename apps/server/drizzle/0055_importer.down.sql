-- 0055_importer.down.sql
DROP TABLE IF EXISTS "characters"."persona_update_seen";
DROP TABLE IF EXISTS "characters"."user_supplements";
DROP TABLE IF EXISTS "importer"."import_raw";
DROP TABLE IF EXISTS "importer"."import_jobs";
DROP SCHEMA IF EXISTS "importer";
