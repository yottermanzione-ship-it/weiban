-- 0017_admin_usage_scenario_modes.sql
-- T-049：管理后台情景模式管理（ADM-05 第 8 条、MODE-04）与人设版本回滚（ADM-06）。
--
-- 1. characters.scenario_modes：情景模式定义表。内置的 4 个模式（daily/tsundere/romance/adult）
--    以 is_builtin = true 预置；内置模式不能删除，只能改预设提示词与启用状态。
-- 2. characters.persona_versions 增加回滚所需的元数据：
--    summary（修改摘要，会展示给用户 CHR-10）、modified_by（修改人）、stability_passed（人设稳定检查结果）。
--    已有历史版本行按默认值补齐（summary 为空、stability_passed = false）。
-- statement-breakpoint
CREATE TABLE "characters"."scenario_modes" (
  "id"                  text        PRIMARY KEY,
  "name"                text        NOT NULL,
  "description"         text        NOT NULL DEFAULT '',
  "preset_prompt"       text,
  "applies_to"          text        NOT NULL DEFAULT 'all',
  "has_romance_content" boolean     NOT NULL DEFAULT false,
  "has_adult_content"   boolean     NOT NULL DEFAULT false,
  "is_builtin"          boolean     NOT NULL DEFAULT false,
  "enabled"             boolean     NOT NULL DEFAULT true,
  "sort_order"          integer     NOT NULL DEFAULT 0,
  "created_at"          timestamptz NOT NULL,
  "updated_at"          timestamptz NOT NULL,
  CONSTRAINT "scenario_modes_applies_to_check"
    CHECK ("applies_to" IN ('all', 'non_minor', 'adult_eligible'))
);
-- statement-breakpoint
INSERT INTO "characters"."scenario_modes"
  ("id", "name", "description", "applies_to",
   "has_romance_content", "has_adult_content", "is_builtin", "enabled", "sort_order",
   "created_at", "updated_at")
VALUES
  ('daily',    '日常', '按角色原本人设相处',           'all',            false, false, true, true, 0, now(), now()),
  ('tsundere', '傲娇', '嘴硬心软、爱怼人，更多小巧思', 'all',            false, false, true, true, 1, now(), now()),
  ('romance',  '恋爱', '以恋人方式相处',               'non_minor',      true,  false, true, true, 2, now(), now()),
  ('adult',    '成人', '允许成人内容',                 'adult_eligible', true,  true,  true, true, 3, now(), now());
-- statement-breakpoint
ALTER TABLE "characters"."persona_versions"
  ADD COLUMN "summary"          text,
  ADD COLUMN "modified_by"      uuid,
  ADD COLUMN "stability_passed" boolean NOT NULL DEFAULT false;
