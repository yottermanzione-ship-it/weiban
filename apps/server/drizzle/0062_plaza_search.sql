-- 0062_plaza_search.sql
-- T-087：广场搜索（角色名、标签、作者昵称、基于的预设角色名，PLZ-01 第 3 条）。
-- 作品内容是公开发布的明文，v1 用 pg_trgm 加速 ILIKE（persona-plaza.md 第 3 节，个人测试规模足够）。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- statement-breakpoint
CREATE INDEX "works_name_trgm_idx" ON "plaza"."works" USING gin ("name" gin_trgm_ops);
-- statement-breakpoint
CREATE INDEX "works_preset_name_trgm_idx" ON "plaza"."works" USING gin ("based_on_preset_name" gin_trgm_ops);
-- statement-breakpoint
CREATE INDEX "works_tags_idx" ON "plaza"."works" USING gin ("tags");
-- statement-breakpoint
CREATE INDEX "author_nickname_trgm_idx" ON "plaza"."author_profiles" USING gin ("nickname" gin_trgm_ops);
