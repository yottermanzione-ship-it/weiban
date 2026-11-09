-- Read-only source metadata audit. Emits only fixed category counts, never field values.
-- This is not a migration plan: the designated new-site owner still must be excluded
-- by the owner-aware planner before any private payload is processed or imported.
PRAGMA query_only=ON;
BEGIN;
WITH customized AS (
  SELECT persona_name, base_signature, base_revision, patch_json
  FROM persona_customizations WHERE state='customized'
), linked AS (
  SELECT c.*,
    (SELECT count(*) FROM persona_base_versions b
     WHERE b.persona_name=c.persona_name AND b.signature=c.base_signature
       AND coalesce(b.revision,'')=coalesce(c.base_revision,'')) AS base_count
  FROM customized c
), exact_base AS (
  SELECT b.package_json FROM linked c JOIN persona_base_versions b
    ON b.persona_name=c.persona_name AND b.signature=c.base_signature
      AND coalesce(b.revision,'')=coalesce(c.base_revision,'')
  WHERE c.base_count=1
)
SELECT json_object(
  'customized', (SELECT count(*) FROM customized),
  'reset', (SELECT count(*) FROM persona_customizations WHERE state='reset'),
  'missing_signature', (SELECT count(*) FROM linked WHERE coalesce(base_signature,'')=''),
  'missing_exact_base', (SELECT count(*) FROM linked WHERE base_count=0),
  'ambiguous_exact_base', (SELECT count(*) FROM linked WHERE base_count>1),
  'exact_base', (SELECT count(*) FROM linked WHERE base_count=1),
  'invalid_patch_json', (SELECT count(*) FROM customized WHERE coalesce(json_valid(patch_json),0)=0),
  'non_object_patch', (SELECT count(*) FROM customized
    WHERE CASE WHEN json_valid(patch_json) THEN json_type(patch_json)<>'object' ELSE 0 END),
  'patch_above_byte_limit', (SELECT count(*) FROM customized WHERE length(CAST(patch_json AS BLOB))>524288),
  'invalid_base_json', (SELECT count(*) FROM exact_base WHERE coalesce(json_valid(package_json),0)=0),
  'non_object_base', (SELECT count(*) FROM exact_base
    WHERE CASE WHEN json_valid(package_json) THEN json_type(package_json)<>'object' ELSE 0 END),
  'base_missing_stable_id', (SELECT count(*) FROM exact_base
    WHERE CASE WHEN json_valid(package_json)
      THEN coalesce(json_type(package_json,'$.id'),'null')<>'text' OR json_extract(package_json,'$.id')=''
      ELSE 0 END)
);
ROLLBACK;
