ALTER TABLE "chat"."messages" DROP COLUMN IF EXISTS "labels";
--> statement-breakpoint
DROP TABLE IF EXISTS "health"."grants";
--> statement-breakpoint
DROP TABLE IF EXISTS "health"."period_settings";
--> statement-breakpoint
DROP TABLE IF EXISTS "health"."period_entries";
--> statement-breakpoint
DROP SCHEMA IF EXISTS "health";
