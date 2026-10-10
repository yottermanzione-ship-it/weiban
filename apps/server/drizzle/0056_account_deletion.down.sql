-- 0056_account_deletion.down.sql
ALTER TABLE "plaza"."adoptions" DROP COLUMN IF EXISTS "author_deleted_at";
-- statement-breakpoint
ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "deletion_rechecks";
