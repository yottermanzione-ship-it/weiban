-- 回滚 0122：好感度回到五级（阈值 0 / 30 / 100 / 300 / 700），去掉暂停亲密表达、称呼与阶段配置。
DROP TABLE IF EXISTS growth.settings;
ALTER TABLE growth.familiarity DROP CONSTRAINT IF EXISTS familiarity_preferred_title_check;
ALTER TABLE growth.familiarity DROP COLUMN IF EXISTS preferred_title;
ALTER TABLE growth.familiarity DROP COLUMN IF EXISTS romance_paused;
ALTER TABLE growth.familiarity DROP CONSTRAINT familiarity_level_check;
UPDATE growth.familiarity SET level =
  CASE
    WHEN total_points >= 700 THEN 5
    WHEN total_points >= 300 THEN 4
    WHEN total_points >= 100 THEN 3
    WHEN total_points >= 30 THEN 2
    ELSE 1
  END;
ALTER TABLE growth.familiarity ADD CONSTRAINT familiarity_level_check CHECK (level BETWEEN 1 AND 5);
