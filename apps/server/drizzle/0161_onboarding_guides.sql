ALTER TABLE identity.preferences ADD COLUMN guide_seen jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE identity.preferences ADD CONSTRAINT preferences_guide_seen_check
  CHECK (jsonb_typeof(guide_seen) = 'array' AND guide_seen <@ '["scenario","miniapps","ecology"]'::jsonb);
