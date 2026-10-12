CREATE TABLE characters.user_child_feature_flags (
 user_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES characters.characters(id) ON DELETE CASCADE,
 detected_at timestamptz NOT NULL,
 PRIMARY KEY (user_id, character_id)
);
--> statement-breakpoint
INSERT INTO characters.user_child_feature_flags (user_id, character_id, detected_at)
SELECT user_id, character_id, updated_at FROM characters.user_supplements
WHERE plaza_source->>'childFeaturesDetected' = 'true'
ON CONFLICT DO NOTHING;
