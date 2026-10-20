-- 回滚 0121：去掉角色资格人工标注与修改记录。
DROP TABLE IF EXISTS characters.eligibility_changes;
ALTER TABLE characters.characters DROP COLUMN IF EXISTS eligibility_override;
