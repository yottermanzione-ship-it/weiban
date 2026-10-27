-- 回滚前先删掉按需复刻的绑定（供应商侧音色不受影响，可用旧版来源规则重新登记）。
DELETE FROM "model_access"."realtime_voice_bindings" WHERE "source" = 'clone';
ALTER TABLE "model_access"."realtime_voice_bindings" DROP CONSTRAINT IF EXISTS "realtime_voice_bindings_source";
ALTER TABLE "model_access"."realtime_voice_bindings"
  ADD CONSTRAINT "realtime_voice_bindings_source" CHECK ("source" IN ('legacy', 'admin'));
