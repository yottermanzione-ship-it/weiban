-- 0073（契约 3.1，积压 ㉕）：分批导入。merge_into_job_id = 创建时指定的目标任务；merged_into_job_id = 实际合并进的任务。
-- 同用户由应用层校验（创建与合并时都按 user_id 查目标）；目标删除时置空。
ALTER TABLE "importer"."import_jobs" ADD COLUMN IF NOT EXISTS "merge_into_job_id" uuid
  REFERENCES "importer"."import_jobs"("id") ON DELETE SET NULL;
ALTER TABLE "importer"."import_jobs" ADD COLUMN IF NOT EXISTS "merged_into_job_id" uuid
  REFERENCES "importer"."import_jobs"("id") ON DELETE SET NULL;
