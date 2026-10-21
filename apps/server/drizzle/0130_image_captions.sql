-- 10-21 试用反馈第四轮 H3（契约 3.29）：图片描述存档。
-- 用户发图时，聊天模型看图回复的同一次调用顺带输出一段简短描述，加密存在这里（按用户密钥），
-- 之后的私聊上下文、记忆、群聊、生态、朋友圈评论都读这段描述。scope = adult 的描述只在私密范围被读到。
-- 种类（是否健康类等）也只在密文里，不落明文列。撤回消息、删除好友会话、注销账号时删除。
CREATE TABLE ai_runtime.image_captions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  media_id uuid NOT NULL,
  scope text NOT NULL,
  message_id uuid,
  conversation_id uuid,
  caption_ciphertext bytea NOT NULL,
  model_key text,
  template text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT image_caption_media_scope_key UNIQUE (user_id, media_id, scope),
  CONSTRAINT image_caption_scope CHECK (scope IN ('normal','adult'))
);
CREATE INDEX image_caption_message_idx ON ai_runtime.image_captions (message_id);
CREATE INDEX image_caption_conversation_idx ON ai_runtime.image_captions (conversation_id);
