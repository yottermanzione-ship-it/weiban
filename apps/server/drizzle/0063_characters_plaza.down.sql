-- 0063_characters_plaza.down.sql：恢复 0008 的分类触发器，删除来源列。
CREATE OR REPLACE FUNCTION characters.guard_classification() RETURNS trigger LANGUAGE plpgsql AS $$
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
DROP INDEX IF EXISTS "characters"."characters_plaza_work_idx";
DROP INDEX IF EXISTS "characters"."characters_plaza_idem_idx";
ALTER TABLE "characters"."characters"
  DROP CONSTRAINT IF EXISTS "characters_plaza_origin",
  DROP CONSTRAINT IF EXISTS "characters_origin_kind",
  DROP COLUMN IF EXISTS "plaza_idempotency_key",
  DROP COLUMN IF EXISTS "plaza_author_name",
  DROP COLUMN IF EXISTS "plaza_version",
  DROP COLUMN IF EXISTS "plaza_work_id",
  DROP COLUMN IF EXISTS "origin_import_job_id",
  DROP COLUMN IF EXISTS "origin_kind";
