-- 旧卡角色头像（2026-10-24 总经理确认旧站头像是 AI 模仿、不是真人，可直接导入）。
-- 只给预设 / 旧卡角色用；新卡（WeibanCardData）的头像仍保存在 card.avatar 内，不读这一列。
ALTER TABLE characters.characters ADD COLUMN avatar_media_id uuid;
COMMENT ON COLUMN characters.characters.avatar_media_id IS
  '旧卡角色头像的 media.objects.id（purpose=character_avatar，平台所有）；新卡角色为 NULL';
CREATE INDEX characters_avatar_media_idx
  ON characters.characters(avatar_media_id)
  WHERE avatar_media_id IS NOT NULL;
