DROP INDEX IF EXISTS characters.characters_avatar_media_idx;
ALTER TABLE characters.characters DROP COLUMN IF EXISTS avatar_media_id;
