-- 0025_public_updates.down.sql
-- 回滚 0025_public_updates.sql（D-L3-02 公开动态）。
DROP TABLE IF EXISTS "characters"."public_update_settings";
DROP TABLE IF EXISTS "characters"."public_updates";
