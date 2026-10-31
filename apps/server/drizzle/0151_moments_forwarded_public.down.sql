-- 0151 回滚：去掉 posts.forwarded_public 列。
-- 回滚前须确认读回侧已不再引用该列，否则先回滚代码再回滚迁移。
ALTER TABLE moments.posts DROP COLUMN forwarded_public;
