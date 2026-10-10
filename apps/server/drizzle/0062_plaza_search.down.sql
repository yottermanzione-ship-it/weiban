-- 0062_plaza_search.down.sql（pg_trgm 扩展可能被其他模块使用，不删除）
DROP INDEX IF EXISTS "plaza"."author_nickname_trgm_idx";
DROP INDEX IF EXISTS "plaza"."works_tags_idx";
DROP INDEX IF EXISTS "plaza"."works_preset_name_trgm_idx";
DROP INDEX IF EXISTS "plaza"."works_name_trgm_idx";
