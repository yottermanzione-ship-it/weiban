-- 0151：posts 增加 forwarded_public 显式标记（微博转发根治收窄口径，2026-10-31 记忆分支结论）。
-- 仅原文转发的公开内容为 true（postForEcology 与微博同步投递写入）；maybePost 生成的私人动态
-- 一律 false，哪怕素材来源是 public_update。旧数据默认 false，保持旧行为（私人路 + 文本比对兜底）。
ALTER TABLE moments.posts ADD COLUMN forwarded_public boolean NOT NULL DEFAULT false;
