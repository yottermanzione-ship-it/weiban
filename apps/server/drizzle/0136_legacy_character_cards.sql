-- 旧角色卡就是运行格式：characters_v2 整行 JSON 原样保存在 legacy_card，不转 WeibanCardData、不改字段名。
ALTER TABLE characters.characters ADD COLUMN legacy_card jsonb;
ALTER TABLE characters.characters ALTER COLUMN draft_ciphertext DROP NOT NULL;
ALTER TABLE characters.characters
  ADD CONSTRAINT characters_card_payload_present
  CHECK (legacy_card IS NOT NULL OR draft_ciphertext IS NOT NULL);
COMMENT ON COLUMN characters.characters.legacy_card IS
  '旧库 characters_v2 整行 JSON；有它就是旧卡角色，运行时直接读旧字段';

-- 旧库 character_lorebook_entries（17,215 条）/ character_example_dialogues（35,082 条）的落点：
-- 新库没有世界书表，最接近的落法是按角色挂接的旧卡附属表，payload 原样存旧行，运行时直读。
CREATE TABLE characters.legacy_lorebook_entries (
  id text PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL
);
CREATE INDEX legacy_lorebook_character_idx
  ON characters.legacy_lorebook_entries(character_id);

CREATE TABLE characters.legacy_example_dialogues (
  id text PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL
);
CREATE INDEX legacy_examples_character_idx
  ON characters.legacy_example_dialogues(character_id, sort_order);
