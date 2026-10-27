-- 批 V（2026-10-27）：实时语音 / Omni 通话的角色音色。供应商复刻音色只在登记它的模型（与账号 workspace）上有效，
-- 所以按 (角色, 模型键) 记一条供应商音色代号；旧站迁入的绑定 source = 'legacy'。没有绑定时用该模型的默认系统音色
-- （model_access.settings 的 realtime_call_voices）。角色被彻底删除时随角色删除。
CREATE TABLE IF NOT EXISTS "model_access"."realtime_voice_bindings" (
  "character_id" uuid NOT NULL,
  "model_key" text NOT NULL,
  "provider_voice_key" text NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "realtime_voice_bindings_pk" PRIMARY KEY ("character_id", "model_key"),
  CONSTRAINT "realtime_voice_bindings_key_len" CHECK (char_length("provider_voice_key") BETWEEN 1 AND 200),
  CONSTRAINT "realtime_voice_bindings_source" CHECK ("source" IN ('legacy', 'admin'))
);
