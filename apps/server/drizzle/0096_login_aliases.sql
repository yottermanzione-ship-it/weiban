ALTER TABLE "identity"."users" ADD COLUMN "current_alias" text;
ALTER TABLE "identity"."users" ADD COLUMN "alias_changed_at" timestamptz;
CREATE TABLE "identity"."login_aliases" (
  "alias" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "identity"."users"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL
);
INSERT INTO "identity"."login_aliases" ("alias", "user_id", "created_at")
SELECT lower("username"), "id", "created_at" FROM "identity"."users";

CREATE INDEX "login_aliases_user_idx" ON "identity"."login_aliases" ("user_id");
