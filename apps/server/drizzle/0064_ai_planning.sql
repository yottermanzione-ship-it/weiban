-- 0064_ai_planning.sql（T-090）：行为规划决策层——按决策类型的实现配置（ADM-05 第 10 条）与决策记录（PLAN-01 第 4 条，保留 90 天）。
CREATE TABLE IF NOT EXISTS "ai_runtime"."planner_config" (
  "decision_type" text PRIMARY KEY,
  "implementation" text NOT NULL DEFAULT 'rules',
  "model_key" text,
  "confidence_threshold" real NOT NULL DEFAULT 0.55,
  "eval_report_id" text,
  "updated_by" uuid,
  "updated_at" timestamptz NOT NULL,
  CONSTRAINT "planner_config_impl" CHECK ("implementation" IN ('rules','rules_model','jev')),
  CONSTRAINT "planner_config_threshold" CHECK ("confidence_threshold" >= 0.3 AND "confidence_threshold" <= 0.9)
);
CREATE TABLE IF NOT EXISTS "ai_runtime"."planning_decisions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "character_id" uuid,
  "conversation_id" uuid,
  "decision_type" text NOT NULL,
  "options" jsonb NOT NULL,
  "choice" text NOT NULL,
  "confidence" real NOT NULL,
  "reason" text NOT NULL,
  "implementation" text NOT NULL,
  "fallback" text,
  "latency_ms" integer NOT NULL DEFAULT 0,
  "usage_record_id" uuid,
  "charged_micros" bigint NOT NULL DEFAULT 0,
  "path" text NOT NULL DEFAULT 'reply',
  "decision_key" text,
  "created_at" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "planning_decisions_user_idx" ON "ai_runtime"."planning_decisions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "planning_decisions_created_idx" ON "ai_runtime"."planning_decisions" ("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "planning_decisions_key_idx" ON "ai_runtime"."planning_decisions" ("user_id", "decision_key");
