-- 0087 回退：新预设回落为日常，恢复旧取值检查与默认值。
UPDATE "ai_runtime"."companion_settings" SET "scenario_mode" = 'daily' WHERE "scenario_mode" IN ('auto','treehole','cheer');
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" DROP CONSTRAINT IF EXISTS "companion_mode";
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD CONSTRAINT "companion_mode" CHECK ("scenario_mode" IN ('daily','tsundere','romance','adult'));
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ALTER COLUMN "scenario_mode" SET DEFAULT 'daily';
