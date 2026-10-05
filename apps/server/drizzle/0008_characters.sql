CREATE SCHEMA "characters";
--> statement-breakpoint
CREATE TABLE "characters"."categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters"."characters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"name" text NOT NULL,
	"search_text" text NOT NULL,
	"category_id" text,
	"basis" text NOT NULL,
	"real_person_kind" text,
	"age_setting" text NOT NULL,
	"child_appearance" boolean NOT NULL,
	"child_features_detected" boolean NOT NULL,
	"published_child_features_detected" boolean DEFAULT true NOT NULL,
	"ever_private_person" boolean DEFAULT false NOT NULL,
	"draft_ciphertext" "bytea" NOT NULL,
	"published_ciphertext" "bytea",
	"published_revision" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"persona_version" integer DEFAULT 1 NOT NULL,
	"checks" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters"."persona_versions" (
	"character_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "persona_versions_character_id_version_pk" PRIMARY KEY("character_id","version")
);
--> statement-breakpoint
ALTER TABLE "characters"."persona_versions" ADD CONSTRAINT "persona_versions_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "characters"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_owner_idx" ON "characters"."characters" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "characters_plaza_idx" ON "characters"."characters" USING btree ("status","category_id");--> statement-breakpoint
CREATE FUNCTION characters.guard_classification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'character ownership is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.kind = 'custom' AND (
      (OLD.basis = 'real_person' AND NEW.basis <> 'real_person') OR
      (OLD.age_setting = 'minor' AND NEW.age_setting <> 'minor') OR
      (OLD.child_appearance AND NOT NEW.child_appearance)
    ) THEN
      RAISE EXCEPTION 'classification_change_forbidden' USING ERRCODE = '23514';
    END IF;
    NEW.ever_private_person := OLD.ever_private_person OR NEW.ever_private_person;
  END IF;
  NEW.ever_private_person := NEW.ever_private_person OR NEW.real_person_kind IS NOT DISTINCT FROM 'private_person';
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_classification BEFORE INSERT OR UPDATE ON characters.characters
FOR EACH ROW EXECUTE FUNCTION characters.guard_classification();
