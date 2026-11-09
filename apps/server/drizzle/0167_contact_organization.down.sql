DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM contacts.organization) THEN
    RAISE EXCEPTION 'CONTACT_ORGANIZATION_ROLLBACK_BLOCKED: preserve personal stars and tags';
  END IF;
END $$;
DROP TABLE contacts.organization_import_receipts;
DROP TABLE contacts.organization_commands;
DROP TABLE contacts.organization_tag_members;
DROP TABLE contacts.organization_tags;
DROP TABLE contacts.organization_stars;
DROP TABLE contacts.organization;
