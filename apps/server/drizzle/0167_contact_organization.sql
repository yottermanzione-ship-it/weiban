CREATE TABLE contacts.organization (
 user_id uuid PRIMARY KEY,
 revision integer NOT NULL CHECK (revision BETWEEN 0 AND 2147483647),
 updated_at timestamptz NOT NULL
);
CREATE TABLE contacts.organization_stars (
 user_id uuid NOT NULL REFERENCES contacts.organization(user_id) ON DELETE CASCADE,
 character_id uuid NOT NULL,
 contact_id uuid NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
 contact_epoch uuid NOT NULL,
 PRIMARY KEY(user_id,character_id)
);
CREATE INDEX organization_stars_contact_idx ON contacts.organization_stars(contact_id);
CREATE TABLE contacts.organization_tags (
 user_id uuid NOT NULL REFERENCES contacts.organization(user_id) ON DELETE CASCADE,
 tag_id uuid NOT NULL,
 name_ciphertext bytea NOT NULL,
 sort_order integer NOT NULL CHECK(sort_order BETWEEN 0 AND 99),
 PRIMARY KEY(user_id,tag_id), UNIQUE(user_id,sort_order)
);
CREATE TABLE contacts.organization_tag_members (
 user_id uuid NOT NULL,
 tag_id uuid NOT NULL,
 character_id uuid NOT NULL,
 contact_id uuid NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
 contact_epoch uuid NOT NULL,
 PRIMARY KEY(user_id,tag_id,character_id),
 FOREIGN KEY(user_id,tag_id) REFERENCES contacts.organization_tags(user_id,tag_id) ON DELETE CASCADE
);
CREATE INDEX organization_members_contact_idx ON contacts.organization_tag_members(contact_id);
CREATE TABLE contacts.organization_commands (
 user_id uuid NOT NULL REFERENCES contacts.organization(user_id) ON DELETE CASCADE,
 command_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 applied_revision integer NOT NULL CHECK(applied_revision>0),
 PRIMARY KEY(user_id,command_id)
);
CREATE TABLE contacts.organization_import_receipts (
 user_id uuid NOT NULL REFERENCES contacts.organization(user_id) ON DELETE CASCADE,
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 applied_revision integer NOT NULL CHECK(applied_revision>0),
 imported_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,source_digest)
);
