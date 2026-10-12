-- 0087_scenario_presets_ai.sql
-- AI 实现三个新情景预设（auto / treehole / cheer）：放宽陪伴设置的取值检查；
-- 新账号默认预设改为「自动」（没有设置行时由代码按 auto 兜底，这里同步列默认值）。
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" DROP CONSTRAINT IF EXISTS "companion_mode";
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ADD CONSTRAINT "companion_mode" CHECK ("scenario_mode" IN ('daily','tsundere','romance','adult','auto','treehole','cheer'));
--> statement-breakpoint
ALTER TABLE "ai_runtime"."companion_settings" ALTER COLUMN "scenario_mode" SET DEFAULT 'auto';
