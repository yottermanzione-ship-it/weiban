-- 0072（契约 3.1，积压 ㉚）：宠物外观单独上下架。
ALTER TABLE "growth"."pet_appearances" ADD COLUMN IF NOT EXISTS "listed" boolean NOT NULL DEFAULT true;
