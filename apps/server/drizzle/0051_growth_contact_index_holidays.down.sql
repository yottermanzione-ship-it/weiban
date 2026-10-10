-- 0051_growth_contact_index_holidays.down.sql
ALTER TABLE "proactive"."holidays" DROP COLUMN IF EXISTS "character_categories";
ALTER TABLE "proactive"."holidays" DROP COLUMN IF EXISTS "card_template_id";
ALTER TABLE "proactive"."holidays" DROP COLUMN IF EXISTS "send_card";
ALTER TABLE "proactive"."holidays" DROP COLUMN IF EXISTS "category";
UPDATE "proactive"."holidays" SET "enabled" = false WHERE "date_type" = 'lunar_annual';
ALTER TABLE "growth"."anniversaries" DROP COLUMN IF EXISTS "updated_at";
ALTER TABLE "growth"."anniversaries" DROP COLUMN IF EXISTS "repeat_yearly";
DROP TABLE IF EXISTS "growth"."notices";
DROP TABLE IF EXISTS "growth"."contact_index";
