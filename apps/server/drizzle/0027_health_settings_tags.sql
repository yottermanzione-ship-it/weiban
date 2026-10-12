-- 0027_health_settings_tags.sql
-- 契约 3.0 health 补齐（T-059 交接缺口）：症状标签字典（ADM-04 第 5 条）。
-- 用户默认周期设置用 0020 已建的 health.period_settings，本迁移不改。
-- statement-breakpoint
CREATE TABLE "health"."symptom_tags" (
  "id"         uuid        PRIMARY KEY,
  "name"       text        NOT NULL,
  "sort_order" integer     NOT NULL,
  "enabled"    boolean     NOT NULL,
  "created_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "symptom_tags_name_check" CHECK (char_length("name") BETWEEN 1 AND 10),
  CONSTRAINT "symptom_tags_order_check" CHECK ("sort_order" >= 0)
);
-- statement-breakpoint
CREATE UNIQUE INDEX "symptom_tags_name_idx" ON "health"."symptom_tags" ("name");
-- statement-breakpoint
-- 初始标签（管理员可在后台改）。
INSERT INTO "health"."symptom_tags" ("id", "name", "sort_order", "enabled", "created_at", "updated_at")
SELECT gen_random_uuid(), v.name, v.ord, true, now(), now()
FROM (VALUES
  ('腹痛', 0), ('腰酸', 1), ('头痛', 2), ('乏力', 3), ('情绪低落', 4),
  ('烦躁', 5), ('胸胀', 6), ('长痘', 7), ('失眠', 8), ('食欲变化', 9)
) AS v(name, ord);
