-- Existing single bindings retain their ID, credentials and peer. No legacy credentials are read.
ALTER TABLE channels.bindings ADD COLUMN slot text NOT NULL DEFAULT 'main';
ALTER TABLE channels.bindings ADD COLUMN reply_conversation_id uuid;
ALTER TABLE channels.bindings ADD COLUMN reply_after_seq bigint;
ALTER TABLE channels.bindings ADD CONSTRAINT bindings_reply_boundary_check CHECK (
  (reply_conversation_id IS NULL AND reply_after_seq IS NULL) OR
  (reply_conversation_id IS NOT NULL AND reply_after_seq IS NOT NULL AND reply_after_seq BETWEEN 0 AND 9007199254740991)
);
-- Existing bindings keep their credentials/peer. Drain the old outbound queue before this
-- migration; delayed outbox events at/below this committed conversation boundary cannot reroute.
UPDATE channels.bindings b SET reply_conversation_id=c.id,reply_after_seq=c.last_seq
FROM chat.conversations c
WHERE b.channel='weibo' AND b.status='active' AND c.type='direct' AND c.archived_at IS NULL
  AND c.owner_user_id=b.user_id AND c.character_id=b.character_id
  AND (SELECT count(*) FROM chat.conversations same
       WHERE same.owner_user_id=b.user_id AND same.character_id=b.character_id
         AND same.type='direct' AND same.archived_at IS NULL)=1;
UPDATE channels.bindings SET last_error='待核对微博回复会话；现有凭据及回信对象已保留'
WHERE channel='weibo' AND status='active' AND reply_conversation_id IS NULL;
ALTER TABLE channels.bindings ADD CONSTRAINT bindings_slot_check
  CHECK (slot IN ('main','blue','white','pink','yellow'));
ALTER TABLE channels.bindings ADD CONSTRAINT bindings_non_weibo_slot_check
  CHECK (channel='weibo' OR slot='main');
DROP INDEX channels.bindings_user_channel_key;
CREATE UNIQUE INDEX bindings_user_channel_slot_key ON channels.bindings(user_id,channel,slot);
CREATE UNIQUE INDEX bindings_weibo_character_key ON channels.bindings(user_id,character_id)
  WHERE channel='weibo' AND status='active' AND character_id IS NOT NULL;
