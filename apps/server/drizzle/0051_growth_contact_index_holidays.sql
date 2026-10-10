-- 0051_growth_contact_index_holidays.sql
-- T-076：纪念日扫描用通讯录索引、一次性通知去重、自定义纪念日「每年提醒」与编辑；
-- 节日清单（proactive.holidays）加农历、类型、是否发节日卡、卡面模板、适用角色分类（契约 3.0.2）。
-- statement-breakpoint
CREATE TABLE "growth"."contact_index" (
  "user_id"         uuid        NOT NULL,
  "character_id"    uuid        NOT NULL,
  "known_since"     date        NOT NULL,
  "active"          boolean     NOT NULL DEFAULT true,
  "last_checked_on" date,
  "updated_at"      timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "character_id")
);
-- statement-breakpoint
CREATE INDEX "contact_index_active_idx" ON "growth"."contact_index" ("active");
-- statement-breakpoint
CREATE TABLE "growth"."notices" (
  "user_id"    uuid        NOT NULL,
  "notice_key" text        NOT NULL,
  "created_at" timestamptz NOT NULL,
  PRIMARY KEY ("user_id", "notice_key")
);
-- statement-breakpoint
ALTER TABLE "growth"."anniversaries" ADD COLUMN "repeat_yearly" boolean NOT NULL DEFAULT false;
-- statement-breakpoint
ALTER TABLE "growth"."anniversaries" ADD COLUMN "updated_at" timestamptz;
-- statement-breakpoint
ALTER TABLE "proactive"."holidays" ADD COLUMN "category" text NOT NULL DEFAULT 'common';
-- statement-breakpoint
ALTER TABLE "proactive"."holidays" ADD COLUMN "send_card" boolean NOT NULL DEFAULT true;
-- statement-breakpoint
ALTER TABLE "proactive"."holidays" ADD COLUMN "card_template_id" uuid;
-- statement-breakpoint
ALTER TABLE "proactive"."holidays" ADD COLUMN "character_categories" text[] NOT NULL DEFAULT '{}'::text[];
