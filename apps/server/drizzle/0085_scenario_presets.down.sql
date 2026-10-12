-- 0085 回退：恢复旧显示名与顺序，删除三个新预设（已选中新预设的设置由 ai-runtime 按日常兜底）。
DELETE FROM "characters"."scenario_modes" WHERE "id" IN ('auto', 'treehole', 'cheer');
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '日常', "description" = '按角色原本人设相处', "sort_order" = 0 WHERE "id" = 'daily';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '傲娇', "description" = '嘴硬心软、爱怼人，更多小巧思', "sort_order" = 1 WHERE "id" = 'tsundere';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '恋爱', "description" = '以恋人方式相处', "sort_order" = 2 WHERE "id" = 'romance';
--> statement-breakpoint
UPDATE "characters"."scenario_modes" SET "name" = '成人', "description" = '允许成人内容', "sort_order" = 3 WHERE "id" = 'adult';
