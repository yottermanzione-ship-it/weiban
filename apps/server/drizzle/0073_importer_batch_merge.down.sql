-- 0073 回滚
ALTER TABLE "importer"."import_jobs" DROP COLUMN IF EXISTS "merged_into_job_id";
ALTER TABLE "importer"."import_jobs" DROP COLUMN IF EXISTS "merge_into_job_id";
