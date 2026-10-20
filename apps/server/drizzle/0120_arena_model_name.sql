-- 10-21 试用反馈第二轮 F2（契约 3.24）：榜单自动获取。
-- 模型的「榜单对应名称」（榜单上叫什么）；抓到的榜单快照存在 model_access.settings（leaderboard_snapshot），不另建表。
ALTER TABLE model_access.model_catalog ADD COLUMN arena_model_name text;
ALTER TABLE model_access.model_catalog ADD CONSTRAINT model_catalog_arena_model_name_check
  CHECK (arena_model_name IS NULL OR char_length(arena_model_name) BETWEEN 1 AND 120);
