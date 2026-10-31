-- 定时跟进（多样性草案 §4，表 follow_ups）：一条事项一行，到点只问一次。
-- 来源是记忆里的 commitment 事实（带明确 dueAt 才建行）；状态 pending / asked / cancelled / expired。
CREATE TABLE ai_runtime.follow_ups (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  conversation_id uuid,
  source_message_id uuid,
  event_text text NOT NULL,
  event_summary text NOT NULL,
  trigger_at timestamptz NOT NULL,
  trigger_rule text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  asked_at timestamptz,
  ask_message_id uuid,
  outcome_text text,
  dedup_hash text NOT NULL,
  cancelled_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT follow_ups_status_check CHECK (status IN ('pending', 'asked', 'cancelled', 'expired')),
  CONSTRAINT follow_ups_dedup UNIQUE (user_id, character_id, dedup_hash)
);
CREATE INDEX follow_ups_due_idx ON ai_runtime.follow_ups (status, trigger_at);
CREATE INDEX follow_ups_pair_idx ON ai_runtime.follow_ups (user_id, character_id, created_at);
