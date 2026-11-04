-- 0158 回滚：删掉站外候选快照、搜索实体关联、后台搜索别名及其登记触发器，投影去掉实体键和出处两列。
-- 后台登记的实体、别名修正会丢失（审计记录仍在 platform.audit_log）；回滚本迁移前须先回滚 T-20261104e 的代码。
-- 投影内容不受影响（下次刷新按 0157 的规则重写；被去掉的人设别名会重新出现在搜索里）。
DROP TRIGGER IF EXISTS search_entities_dirty ON characters.search_entities;
DROP TRIGGER IF EXISTS search_entity_characters_dirty ON characters.search_entity_characters;
DROP TRIGGER IF EXISTS search_aliases_dirty ON characters.search_aliases;
DROP FUNCTION IF EXISTS characters.mark_search_dirty_by_entity();
DROP FUNCTION IF EXISTS characters.mark_search_dirty_by_character();
DROP FUNCTION IF EXISTS characters.mark_search_dirty_for(uuid);
ALTER TABLE characters.search_terms DROP COLUMN IF EXISTS source_url;
ALTER TABLE characters.search_terms DROP COLUMN IF EXISTS entity_key;
DROP TABLE IF EXISTS characters.search_aliases;
DROP TABLE IF EXISTS characters.search_entity_characters;
DROP TABLE IF EXISTS characters.search_entity_identifiers;
DROP TABLE IF EXISTS characters.search_entities;
DROP TABLE IF EXISTS model_access.web_candidates;
