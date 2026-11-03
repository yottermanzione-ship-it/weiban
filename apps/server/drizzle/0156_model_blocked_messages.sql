-- 0156（T-20261103j）：被上游安全策略拦下的用户消息，不再发给模型。
-- 2026-11-03 私密模型（Abliteration）对一条用户消息回 403 policy_violation。被拦的那条留在聊天历史里，
-- 之后每次回复都带上它，于是一直被拦、只回推托语，会话卡死。这里登记「不再发给模型」的消息：
-- 回复因 content_rejected 失败时，回复引擎把这次回复针对的用户消息自动登记（source = 'auto'）；
-- 也可以按会话 ID + 消息序号手工登记（source = 'manual'，SQL 见 docs/handoffs/2026-11-03-private-policy-block.md）。
-- 只存 ID 与序号，不存正文。用户界面照常显示这些消息；读这张表的只有 ai_runtime 组装模型上下文的地方
-- （回复上下文、翻聊天记录、记忆抽取、私密整理、聊天摘要、通话、主动消息、名场面、互动玩法）。
-- 删除好友会话（contacts.contact_purged）、彻底删除角色、注销账号时一并删除。
CREATE TABLE ai_runtime.model_blocked_messages (
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL,
  user_id uuid NOT NULL,
  character_id uuid NOT NULL,
  message_id uuid,
  source text NOT NULL,
  reason text NOT NULL DEFAULT 'content_rejected',
  plan_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_blocked_messages_pkey PRIMARY KEY (conversation_id, seq),
  CONSTRAINT model_blocked_seq CHECK (seq > 0 AND seq <= 9007199254740991),
  CONSTRAINT model_blocked_source CHECK (source IN ('auto','manual'))
);
CREATE INDEX model_blocked_user_idx ON ai_runtime.model_blocked_messages (user_id);
CREATE INDEX model_blocked_character_idx ON ai_runtime.model_blocked_messages (character_id);
