-- 0157 回滚：删掉站内搜索投影、待刷新登记表和登记触发器。只删本迁移新建的对象；
-- pg_trgm 由 0062 启用、别处也在用，不删除。回滚后站内联想 / 聚合结果接口查不到任何结果
-- （表不存在会报错），回滚本迁移前须先回滚 T-20261104b 的代码。
DROP TRIGGER IF EXISTS works_search_dirty ON plaza.works;
DROP FUNCTION IF EXISTS plaza.mark_search_dirty();
DROP TABLE IF EXISTS plaza.search_dirty;
DROP TABLE IF EXISTS plaza.search_terms;
DROP TRIGGER IF EXISTS characters_search_dirty ON characters.characters;
DROP FUNCTION IF EXISTS characters.mark_search_dirty();
DROP TABLE IF EXISTS characters.search_dirty;
DROP TABLE IF EXISTS characters.search_terms;
