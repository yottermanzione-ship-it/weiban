DROP TABLE "identity"."login_aliases";
ALTER TABLE "identity"."users" DROP COLUMN "current_alias";
ALTER TABLE "identity"."users" DROP COLUMN "alias_changed_at";
