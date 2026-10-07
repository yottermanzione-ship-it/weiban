import { pgSchema, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
export const mediaSchema = pgSchema('media');
export const objects = mediaSchema.table(
  'objects',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id'),
    purpose: text('purpose').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [index('objects_owner_idx').on(t.ownerId)],
);
