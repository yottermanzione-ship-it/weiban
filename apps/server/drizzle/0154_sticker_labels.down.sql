-- 0153 回滚：去掉表情包标签表。
-- 回滚前须确认选图读标签的代码已先回滚，否则 listStickersForCharacter 的 LEFT JOIN 会找不到表。
-- 回滚会丢掉已回填的全部标签行；重上时须重新跑回填脚本（幂等，以 JSONL 为准）。
DROP TABLE media.library_sticker_labels;
