-- 回滚会丢掉旧卡原样文本；还有只有 legacy_card、没有新卡草稿的角色时拒绝回滚，避免静默丢数据。
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM characters.characters
    WHERE legacy_card IS NOT NULL AND draft_ciphertext IS NULL
  ) THEN
    RAISE EXCEPTION '存在只有 legacy_card 的旧卡角色；回滚会丢失运行格式，请先备份并前滚';
  END IF;
END $$;
DROP TABLE IF EXISTS characters.legacy_example_dialogues;
DROP TABLE IF EXISTS characters.legacy_lorebook_entries;
ALTER TABLE characters.characters DROP CONSTRAINT IF EXISTS characters_card_payload_present;
ALTER TABLE characters.characters DROP COLUMN IF EXISTS legacy_card;
ALTER TABLE characters.characters ALTER COLUMN draft_ciphertext SET NOT NULL;
