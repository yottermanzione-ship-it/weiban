-- 0026_health_care_ledger.sql
-- T-060 L3 经期关怀配额账本（PLAY-01 第 6 条、P-36，health-data.md 第 4 节）。
-- 只记录「某周期某名额已用」，cycle_key 为 health 模块给出的不透明随机 ID；
-- 不存日期、痛感、症状等任何经期内容。
-- statement-breakpoint
CREATE TABLE "ai_runtime"."health_care_ledger" (
  "user_id"      uuid NOT NULL,
  "cycle_key"    text NOT NULL,
  "slot"         text NOT NULL,
  "character_id" uuid,
  CONSTRAINT "health_care_ledger_slot_idx" UNIQUE ("user_id", "cycle_key", "slot")
);
