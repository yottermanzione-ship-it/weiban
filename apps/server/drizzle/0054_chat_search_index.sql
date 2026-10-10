-- 0054_chat_search_index.sql
-- T-078 聊天记录搜索（ADR-0027）：正文加密存放，无法建 pg_trgm 明文索引；
-- 这里只建「可搜索消息」的部分索引，按会话 + seq 倒序快速取出待解密匹配的候选。
CREATE INDEX IF NOT EXISTS "messages_searchable_idx" ON "chat"."messages" ("conversation_id","seq" DESC)
  WHERE "status" = 'normal'
    AND ("content_type" IS NULL OR "content_type" IN ('text','link','letter','daily_question','voice'));
