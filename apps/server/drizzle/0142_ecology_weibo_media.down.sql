DROP TABLE IF EXISTS ai_runtime.weibo_item_media;
ALTER TABLE ai_runtime.weibo_items DROP CONSTRAINT IF EXISTS weibo_items_media_state;
ALTER TABLE ai_runtime.weibo_items DROP COLUMN IF EXISTS media_attempted_at;
ALTER TABLE ai_runtime.weibo_items DROP COLUMN IF EXISTS media_state;
