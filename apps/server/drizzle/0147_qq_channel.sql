-- QQ 为新建测试机器人单独增加凭据与一次性配对；不更新任何微信/微博绑定、凭据或代际。
ALTER TABLE channels.bindings DROP CONSTRAINT bindings_channel_check;
ALTER TABLE channels.bindings ADD CONSTRAINT bindings_channel_check CHECK (channel IN ('wechat','weibo','qq'));
ALTER TABLE channels.inbound_messages DROP CONSTRAINT inbound_messages_channel_check;
ALTER TABLE channels.inbound_messages ADD CONSTRAINT inbound_messages_channel_check CHECK (channel IN ('wechat','weibo','qq'));
ALTER TABLE channels.outbound_messages DROP CONSTRAINT outbound_messages_channel_check;
ALTER TABLE channels.outbound_messages ADD CONSTRAINT outbound_messages_channel_check CHECK (channel IN ('wechat','weibo','qq'));

CREATE TABLE channels.qq_sessions (
  binding_id uuid PRIMARY KEY REFERENCES channels.bindings(id) ON DELETE CASCADE,
  generation integer NOT NULL,
  app_fingerprint text NOT NULL UNIQUE,
  app_id_sealed bytea NOT NULL,
  app_secret_sealed bytea NOT NULL,
  pairing_hash bytea,
  pairing_expires_at timestamptz,
  pairing_failures integer NOT NULL DEFAULT 0,
  reply_id_sealed bytea,
  reply_expires_at timestamptz,
  reply_seq integer NOT NULL DEFAULT 0
);
-- 重试固定使用首次领取的被动消息引用与序号，不能借用户后来的消息重复投递。
ALTER TABLE channels.outbound_messages
  ADD COLUMN qq_reply_id_sealed bytea,
  ADD COLUMN qq_reply_seq integer,
  ADD COLUMN qq_reply_expires_at timestamptz;
