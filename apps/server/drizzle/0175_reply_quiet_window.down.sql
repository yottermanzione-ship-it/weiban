DROP TABLE chat.reply_batch_parts;
--> statement-breakpoint
DROP TABLE platform.reply_worker_slots;
--> statement-breakpoint
DROP INDEX chat.chat_user_reply_seq_idx;
--> statement-breakpoint
ALTER TABLE chat.conversations DROP COLUMN reply_quiet_until, DROP COLUMN reply_batch_key;
--> statement-breakpoint
ALTER TABLE ai_runtime.reply_plans DROP COLUMN batch_first_seq;
--> statement-breakpoint
ALTER TABLE chat.messages DROP COLUMN reply_batch_first_seq;
