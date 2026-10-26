-- 聊天背景（2026-10-25）：本人给单个会话单独设置的背景图，存 media.objects.id（purpose=chat_background）。
-- 与其它媒体列一致，不加外键；NULL = 使用默认背景，只影响本人、只影响这个会话。
ALTER TABLE chat.user_conversation_states ADD COLUMN background_media_id uuid;
