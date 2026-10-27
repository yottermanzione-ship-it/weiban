-- V2（2026-10-28）：实时通话按需复刻。角色在某个实时模型下没有音色、但有声音样本时，接通前当场复刻一个只给该模型用的音色，
-- 写入 realtime_voice_bindings，来源记为 'clone'（旧站迁入仍为 'legacy'，管理员登记为 'admin'）。只放宽来源检查，不动数据。
ALTER TABLE "model_access"."realtime_voice_bindings" DROP CONSTRAINT IF EXISTS "realtime_voice_bindings_source";
ALTER TABLE "model_access"."realtime_voice_bindings"
  ADD CONSTRAINT "realtime_voice_bindings_source" CHECK ("source" IN ('legacy', 'admin', 'clone'));
