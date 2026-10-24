-- 设置 › 插件 › 微信 / 微博接入（3.42，2026-10-25 按真实旧协议重做）。
--
-- 真实协议（与旧版服务器 C:/wb-ref/old-weiban/server/lib 一致）：
--   微信 = iLink（ClawBot）服务器主动长轮询：get_bot_qrcode → get_qrcode_status → getupdates / sendmessage。
--   微博 = OpenIM：AppID / AppSecret 换 ws_token → WSS stream。
-- 没有「外部网关」，也没有 webhook 回调；绑定与消息都由本进程按用户主动发起的流程产生。
--
-- 安全：可复用的凭据（微信 bot_token、微博 AppSecret、二维码 qrcode、上下文 context_token）和
-- 入站 / 出站消息正文一律是该用户 DEK 信封加密后的 bytea；表里没有任何明文密钥或明文正文。
-- 解绑保留 tombstone 行（便于后台排查），但清空凭据列与该绑定的排队消息。

CREATE SCHEMA IF NOT EXISTS channels;

CREATE TABLE channels.bindings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('wechat','weibo')),
  status text NOT NULL DEFAULT 'unbound' CHECK (status IN ('unbound','active','revoked')),
  -- 出口角色：用户在微伴里选的那个好友；改角色不需要重新授权。
  character_id uuid,
  character_name text,
  -- 对面账号：微信 ilink_user_id / 微博 bot uid；解绑时清空。
  account_id text,
  account_name text,
  -- 微信 iLink：ilink_bot_id 与服务节点（只存白名单节点；空串表示未设置）。
  bot_id text,
  base_url text NOT NULL DEFAULT '',
  -- get_updates_buf 游标：必须持久化，否则进程重启会重放已处理的消息。
  cursor text NOT NULL DEFAULT '',
  -- 凭据（该用户 DEK 加密）：微信 bot_token；微博 AppID / AppSecret。
  bot_token_sealed bytea,
  weibo_app_id_sealed bytea,
  weibo_app_secret_sealed bytea,
  -- 最近一次入站消息的 context_token（出站带 context_token 更稳；同样是凭据）。
  context_token_sealed bytea,
  -- 重绑计数：后台轮询任务带着 generation 跑，重建绑定后旧任务自动作废。
  generation integer NOT NULL DEFAULT 1,
  bound_at timestamptz,
  unbound_at timestamptz,
  last_event_at timestamptz,
  last_poll_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- 一个用户一个渠道最多一条绑定。
CREATE UNIQUE INDEX bindings_user_channel_key ON channels.bindings(user_id, channel);
-- 同一个对面账号只能挂在一个微伴账号上（重新绑定会把别人的旧绑定改成 revoked 并清空凭据）。
CREATE UNIQUE INDEX bindings_active_account_key
  ON channels.bindings(channel, account_id)
  WHERE status = 'active' AND account_id IS NOT NULL;
-- 后台轮询只找「本新站用户自己绑好且仍有效」的行。
CREATE INDEX bindings_active_idx ON channels.bindings(channel, last_poll_at)
  WHERE status = 'active';

-- 微信二维码绑定会话。二维码本身能换 bot_token，按凭据处理：加密存 qrcode。
CREATE TABLE channels.bind_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('wechat','weibo')),
  status text NOT NULL DEFAULT 'wait'
    CHECK (status IN ('creating','wait','scanned','confirmed','expired','failed')),
  character_id uuid NOT NULL,
  character_name text NOT NULL,
  qrcode_sealed bytea NOT NULL,
  -- 页面渲染二维码用的 liteapp 链接（不含 token，可以直接下发客户端）。
  bind_url text NOT NULL,
  -- 扫码被指到别的微信节点时记下来，后续状态查询带过去。
  poll_base_url text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  confirmed_binding_id uuid,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX bind_attempts_user_idx ON channels.bind_attempts(user_id, channel, created_at);
-- 同一用户同一渠道只留一个「还在等扫码」的会话：出新码时旧码立即作废（ON CONFLICT 靠这个索引）。
CREATE UNIQUE INDEX bind_attempts_pending_key
  ON channels.bind_attempts(user_id, channel)
  WHERE status IN ('creating','wait','scanned');

-- 入站流水：网关（这里就是本进程的 iLink 长轮询）拉到的每条消息。
-- (binding_id, external_message_id) 唯一 = 幂等；client_msg_id 固定，重试投递到聊天时不会被当成两条。
CREATE TABLE channels.inbound_messages (
  id uuid PRIMARY KEY,
  binding_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('wechat','weibo')),
  external_message_id text NOT NULL,
  sender_id text NOT NULL,
  text_sealed bytea,
  context_token_sealed bytea,
  -- 投递给聊天模块时用的幂等键（聊天模块要求 UUID）。
  client_msg_id uuid NOT NULL,
  message_created_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','accepted','duplicate','rejected','failed')),
  reason text,
  chat_message_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX inbound_messages_event_key
  ON channels.inbound_messages(binding_id, external_message_id);
CREATE INDEX inbound_messages_user_idx ON channels.inbound_messages(user_id, created_at);
CREATE INDEX inbound_messages_pending_idx ON channels.inbound_messages(binding_id)
  WHERE outcome = 'pending';

-- 出站队列：角色在私聊里的回复 → 发回微信 / 微博。
-- (binding_id, chat_message_id) 唯一：同一条聊天消息只发一次；失败按 next_attempt_at 重试。
CREATE TABLE channels.outbound_messages (
  id uuid PRIMARY KEY,
  binding_id uuid NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('wechat','weibo')),
  chat_message_id uuid NOT NULL,
  text_sealed bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','retry','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX outbound_messages_chat_key
  ON channels.outbound_messages(binding_id, chat_message_id);
CREATE INDEX outbound_messages_due_idx ON channels.outbound_messages(next_attempt_at)
  WHERE status IN ('pending','retry');

COMMENT ON TABLE channels.bindings IS
  '微信 / 微博绑定关系（3.42）：凭据与 context_token 都是该用户 DEK 加密的 bytea；解绑保留 tombstone 并清空凭据。';
COMMENT ON TABLE channels.bind_attempts IS
  '微信扫码绑定会话（3.42）：qrcode 加密存库（能换 bot_token），bind_url 可直接下发客户端画二维码。';
COMMENT ON TABLE channels.inbound_messages IS
  '入站消息流水（3.42）：(binding_id, external_message_id) 唯一做幂等；正文加密；client_msg_id 是投递聊天的固定幂等键。';
COMMENT ON TABLE channels.outbound_messages IS
  '出站消息队列（3.42）：角色回复按 (binding_id, chat_message_id) 去重发送；失败按 next_attempt_at 重试。';
