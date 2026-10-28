-- 仅回退新 QQ 通道，不操作已有微信 / 微博记录。生产常规回滚保留前向兼容表，不运行此文件。
DELETE FROM channels.outbound_messages WHERE channel='qq';
DELETE FROM channels.inbound_messages WHERE channel='qq';
DROP TABLE channels.qq_sessions;
DELETE FROM channels.bindings WHERE channel='qq';
ALTER TABLE channels.outbound_messages DROP COLUMN qq_reply_id_sealed, DROP COLUMN qq_reply_seq, DROP COLUMN qq_reply_expires_at;
ALTER TABLE channels.bindings DROP CONSTRAINT bindings_channel_check;
ALTER TABLE channels.bindings ADD CONSTRAINT bindings_channel_check CHECK (channel IN ('wechat','weibo'));
ALTER TABLE channels.inbound_messages DROP CONSTRAINT inbound_messages_channel_check;
ALTER TABLE channels.inbound_messages ADD CONSTRAINT inbound_messages_channel_check CHECK (channel IN ('wechat','weibo'));
ALTER TABLE channels.outbound_messages DROP CONSTRAINT outbound_messages_channel_check;
ALTER TABLE channels.outbound_messages ADD CONSTRAINT outbound_messages_channel_check CHECK (channel IN ('wechat','weibo'));
