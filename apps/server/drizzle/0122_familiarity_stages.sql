-- 10-21 试用反馈第三轮 G1-6/7（契约 3.25）：好感度改回旧版六阶段（粉丝 / 朋友 / 亲密好友 / 暧昧 / 恋人 / 伴侣）。
-- 点数规则不变（16 号 §11），只把阈值映射到六阶段：默认 0 / 100 / 400 / 500 / 600 / 700（后台可调，存 growth.settings）。
ALTER TABLE growth.familiarity DROP CONSTRAINT familiarity_level_check;
ALTER TABLE growth.familiarity ADD CONSTRAINT familiarity_level_check CHECK (level BETWEEN 1 AND 6);
-- 暂停亲密表达（旧版 romance_paused）与用户希望的称呼（旧版 preferred_partner_title）。
ALTER TABLE growth.familiarity
  ADD COLUMN romance_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN preferred_title text,
  ADD CONSTRAINT familiarity_preferred_title_check
    CHECK (preferred_title IS NULL OR char_length(preferred_title) BETWEEN 1 AND 20);
-- 已有记录按累计点数换算成新阶段。存库的阶段先按「未付费」最高到第 3 阶段（亲密好友）；
-- 付费 / 会员用户读取时按点数直接显示更高阶段，下次加分时写回（growth.service 的 effectiveLevel）。
UPDATE growth.familiarity SET level = LEAST(3,
  CASE
    WHEN total_points >= 700 THEN 6
    WHEN total_points >= 600 THEN 5
    WHEN total_points >= 500 THEN 4
    WHEN total_points >= 400 THEN 3
    WHEN total_points >= 100 THEN 2
    ELSE 1
  END);
-- growth 的后台配置（键值）：familiarity_stages = { thresholds: number[6] }。
CREATE TABLE growth.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid
);
