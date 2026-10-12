-- 0085_scenario_presets.sql
-- 换壳 UI 批次（docs/refactor/02 第 5 节）：情景模式在界面上改叫「情景预设」，改显示名与顺序，
-- 并登记三个新预设 auto / treehole / cheer（AI 策略未实现前按日常回复）。
-- 用户端预设列表目前由 ai-runtime 代码里的 INITIAL_MODES 决定；本表供管理后台查看与维护，两处保持一致。
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '日常聊天', "description" = '像朋友一样聊', "sort_order" = 1, "updated_at" = now() WHERE "id" = 'daily';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '情侣暧昧', "description" = '甜一点、黏一点', "sort_order" = 2, "updated_at" = now() WHERE "id" = 'romance';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '傲娇斗嘴', "description" = '嘴硬心软，爱怼你', "sort_order" = 4, "updated_at" = now() WHERE "id" = 'tsundere';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '私密', "description" = '只在你们俩之间（成人内容）', "sort_order" = 6, "updated_at" = now() WHERE "id" = 'adult';
--> statement-breakpoint
INSERT INTO "characters"."scenario_modes"
  ("id", "name", "description", "applies_to",
   "has_romance_content", "has_adult_content", "is_builtin", "enabled", "sort_order",
   "created_at", "updated_at")
VALUES
  ('auto',     '自动',     'TA 看你当下的状态自己调整', 'all', false, false, true, true, 0, now(), now()),
  ('treehole', '树洞分享', '多听少说，不评判',           'all', false, false, true, true, 3, now(), now()),
  ('cheer',    '加油打气', '给你打气，也会督促你',       'all', false, false, true, true, 5, now(), now())
ON CONFLICT ("id") DO NOTHING;
