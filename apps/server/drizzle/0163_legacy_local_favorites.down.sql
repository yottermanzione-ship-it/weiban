DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM library.legacy_favorites) THEN
  RAISE EXCEPTION 'legacy_favorites_contain_user_data_forward_fix_required';
 END IF;
END $$;
DROP TABLE library.legacy_favorite_media_links;
DROP TABLE library.legacy_favorites;
DROP TABLE library.legacy_favorite_sources;
