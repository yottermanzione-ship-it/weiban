-- 10-21 试用反馈第三轮 G1-2（契约 3.25）：后台人工标注角色资格。
-- eligibility_override：管理员人工标注的分类事实（basis / realPersonKind / ageSetting / childAppearance /
-- childFeaturesDetected，全量 JSON），优先于资料里的分类与 AI / 系统检出；null = 没有人工标注，按自动结果。
-- 不改原有列与分类触发器：自动结果照常维护，清除人工标注即恢复。
ALTER TABLE characters.characters ADD COLUMN eligibility_override jsonb;
-- 修改记录（谁、何时、原因必填）；另在 platform 审计日志写一条。
CREATE TABLE characters.eligibility_changes (
  id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
  operator_user_id uuid,
  reason text NOT NULL,
  before_override jsonb,
  after_override jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT eligibility_changes_reason_check CHECK (char_length(reason) BETWEEN 2 AND 200)
);
CREATE INDEX eligibility_changes_character_idx ON characters.eligibility_changes (character_id, created_at DESC);
