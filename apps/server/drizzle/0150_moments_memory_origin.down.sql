-- 0150 回滚：把 memories.origin 的 check 约束收回 0134 的四值。
-- 回滚前须确认没有 origin='moments' 的行，否则加约束会失败（应先处理或放弃回滚）。
ALTER TABLE ai_runtime.memories DROP CONSTRAINT memories_origin_check;
ALTER TABLE ai_runtime.memories ADD CONSTRAINT memories_origin_check CHECK (origin IN ('private_chat','group','call','system'));
