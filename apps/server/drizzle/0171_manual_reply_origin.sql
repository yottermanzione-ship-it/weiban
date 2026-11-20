ALTER TABLE ai_runtime.reply_plans ADD COLUMN manual_requested boolean NOT NULL DEFAULT false;
-- Only this marker proves an original-message retry was explicitly requested.
UPDATE ai_runtime.reply_plans SET manual_requested=true WHERE kind='message' AND failure='manual_retry';
