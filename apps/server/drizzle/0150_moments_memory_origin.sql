-- 0150：朋友圈记忆写回新增 memories.origin='moments'（2026-10-31 04:42 决定）。
-- 只放宽 check 约束，不动已有数据。约束名与 schema.ts 的 check 名一致（memories_origin_check，
-- 与 0134 建表时 ADD COLUMN 生成的约束名相同）。
ALTER TABLE ai_runtime.memories DROP CONSTRAINT memories_origin_check;
ALTER TABLE ai_runtime.memories ADD CONSTRAINT memories_origin_check CHECK (origin IN ('private_chat','group','call','system','moments'));
