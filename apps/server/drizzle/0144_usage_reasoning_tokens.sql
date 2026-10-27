-- 批 EJ（2026-10-27）：思考 token 单独计量。output_tokens 仍是含思考的总输出（计费不变），
-- reasoning_tokens 只记其中的思考部分（上游报告或按思考内容估算；未知为 NULL），供后台按元数据核对后台任务成本。
ALTER TABLE "model_access"."usage_records" ADD COLUMN IF NOT EXISTS "reasoning_tokens" integer;
