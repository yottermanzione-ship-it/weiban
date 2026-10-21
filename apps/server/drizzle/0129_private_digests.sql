-- 10-21 试用反馈第四轮 H2（契约 3.28）：切出私密模式时的「干净整理」任务。
-- 每次切出（以切换事件为准）一行：由私密模型把这段私密模式对话整理成不含露骨描写的摘要，
-- 写成一条日常（normal）范围的记忆。event_key 保证同一次切换只生成一次；失败按 next_attempt_at 重试。
CREATE TABLE ai_runtime.private_digests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  event_key text NOT NULL,
  -- 切出时会话的最后序号：整理 (上一次切出的 to_seq, to_seq] 之间的私密消息。
  to_seq bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  memory_id uuid,
  charged_micros bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT private_digest_event_idx UNIQUE (conversation_id, event_key),
  CONSTRAINT private_digest_status CHECK (status IN ('pending','failed','done','skipped','abandoned'))
);
CREATE INDEX private_digest_due_idx ON ai_runtime.private_digests (status, next_attempt_at);
CREATE INDEX private_digest_conv_idx ON ai_runtime.private_digests (conversation_id, to_seq);
CREATE INDEX private_digest_user_idx ON ai_runtime.private_digests (user_id);
