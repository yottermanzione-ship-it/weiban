-- 0084 回退：只删没有被领养、起名请求引用的内置图鉴行，以及没有被引用的占位素材。
DELETE FROM "growth"."pet_appearances" a WHERE a."id"::text LIKE '5e7a0000-0000-4000-8000-%'
  AND NOT EXISTS (SELECT 1 FROM "growth"."pets" p WHERE p."appearance_id" = a."id")
  AND NOT EXISTS (SELECT 1 FROM "growth"."pet_naming_requests" r WHERE r."appearance_id" = a."id");
--> statement-breakpoint
DELETE FROM "growth"."pet_species" s WHERE s."id"::text LIKE '5e7a0000-0000-4000-8000-%'
  AND NOT EXISTS (SELECT 1 FROM "growth"."pet_appearances" a WHERE a."species_id" = s."id");
--> statement-breakpoint
DELETE FROM "media"."objects" o WHERE o."storage_key" LIKE 'builtin/pet/%'
  AND NOT EXISTS (SELECT 1 FROM "growth"."pet_appearances" a
    WHERE o."id" IN (a."baby_media_id", a."junior_media_id", a."adult_media_id"));
