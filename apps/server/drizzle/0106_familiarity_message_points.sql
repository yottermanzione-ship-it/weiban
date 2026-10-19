-- 好感度按消息加分（16 号 §11，总经理 10-20）：记录上一条消息指纹（不存正文）与上一条计分消息时刻，防脚本刷分。
ALTER TABLE growth.familiarity ADD COLUMN last_message_hash text,
  ADD COLUMN last_message_scored_at timestamptz;
