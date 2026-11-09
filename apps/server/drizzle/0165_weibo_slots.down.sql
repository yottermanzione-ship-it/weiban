-- Refuse a destructive downgrade after non-main slots have acquired any persistent history.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM channels.bindings WHERE slot<>'main') THEN
    RAISE EXCEPTION 'WEIBO_MULTI_SLOT_ROLLBACK_BLOCKED: preserve non-main binding history';
  END IF;
END $$;
DROP INDEX channels.bindings_weibo_character_key;
DROP INDEX channels.bindings_user_channel_slot_key;
ALTER TABLE channels.bindings DROP CONSTRAINT bindings_non_weibo_slot_check;
ALTER TABLE channels.bindings DROP CONSTRAINT bindings_slot_check;
ALTER TABLE channels.bindings DROP CONSTRAINT bindings_reply_boundary_check;
ALTER TABLE channels.bindings DROP COLUMN reply_conversation_id;
ALTER TABLE channels.bindings DROP COLUMN reply_after_seq;
ALTER TABLE channels.bindings DROP COLUMN slot;
CREATE UNIQUE INDEX bindings_user_channel_key ON channels.bindings(user_id,channel);
