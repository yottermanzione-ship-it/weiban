/** Migration-only orchestration. Never used by normal registration/chat/payment flows. */
import {
  assertLegacyMigrationOwnerAllowed,
  isLegacyMigrationOwnerPreserved,
  legacyMigrationOwnerDigest,
} from './legacy-migration-preservation.mjs';

export const extraPreservedOwners = (options = {}) => options.additionalPreservedOwnerDigests ?? [];
export function assertMigrationOwnersAllowed(owners, options = {}) {
  for (const owner of new Set(owners))
    assertLegacyMigrationOwnerAllowed(owner, extraPreservedOwners(options));
}
/** Explicit source provenance must survive a target mapping; never infer it from a name. */
export function migrationOwnersOf(row, targetOwner) {
  return [
    targetOwner,
    ...[
      'sourceOwnerUserId',
      'legacyOwnerUserId',
      'sourceUserId',
      'source_owner_user_id',
      'source_user_id',
    ]
      .filter((key) => row?.[key] != null)
      .map((key) => row[key]),
  ];
}
export function isMigrationOwnerPreserved(owner, options = {}) {
  return isLegacyMigrationOwnerPreserved(owner, extraPreservedOwners(options));
}
export function preservedOwnerSkip(owner, count = 1) {
  return { ownerDigest: legacyMigrationOwnerDigest(owner), reason: 'preserve_new_account', count };
}
export function partitionMigrationOwners(rows, ownerOf, options = {}) {
  const allowed = [],
    skipped = [];
  for (const row of rows) {
    const owners = [ownerOf(row)].flat();
    const preserved = owners.find((owner) => isMigrationOwnerPreserved(owner, options));
    if (preserved) skipped.push(preservedOwnerSkip(preserved));
    else allowed.push(row);
  }
  return { allowed, skipped };
}
/** Existing destination IDs must be checked too: a re-signed plan cannot lie about its owner. */
export async function assertMigrationConversationOwners(tx, ids, options = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const { rows } = await tx.query(
    'SELECT owner_user_id FROM chat.conversations WHERE id=ANY($1::uuid[])',
    [unique],
  );
  assertMigrationOwnersAllowed(
    rows.map((row) => row.owner_user_id),
    options,
  );
}
export async function assertMigrationMediaOwners(tx, ids, options = {}) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const { rows } = await tx.query('SELECT owner_id FROM media.objects WHERE id=ANY($1::uuid[])', [
    unique,
  ]);
  assertMigrationOwnersAllowed(
    rows.map((row) => row.owner_id),
    options,
  );
}
export function scopeMigrationBaseline(baseline, scope) {
  const owners = new Set(scope.ownerUserIds),
    result = { ...baseline };
  if (baseline.users) result.users = baseline.users.filter((row) => owners.has(row.id));
  for (const key of ['profiles', 'contacts', 'states'])
    if (baseline[key]) result[key] = baseline[key].filter((row) => owners.has(row.user_id));
  if (baseline.conversations)
    result.conversations = baseline.conversations.filter((row) => owners.has(row.owner_user_id));
  const conversationIds = new Set(result.conversations?.map((row) => row.id) ?? []);
  if (baseline.participants)
    result.participants = baseline.participants.filter((row) =>
      conversationIds.has(row.conversation_id),
    );
  const characterIds = new Set(
    scope.characterIds ?? result.contacts?.map((row) => row.character_id) ?? [],
  );
  if (baseline.characters)
    result.characters = baseline.characters.filter((row) => characterIds.has(row.id));
  if (baseline.media && scope.mediaIds)
    result.media = baseline.media.filter((row) => scope.mediaIds.includes(row.id));
  return result;
}
/** Full legacy importers already materialize the source. Refuse the whole run before writes. */
export function assertLegacySnapshotOwnersAllowed(data, options = {}) {
  const owners = [];
  for (const [table, rows] of data)
    for (const row of rows) {
      if (table === 'app_users') owners.push(row.id);
      for (const field of ['user_id', 'owner_user_id', 'owner_id', 'source_user_id'])
        if (row[field] != null && String(row[field]).trim()) owners.push(String(row[field]));
      if (row.user_key) owners.push(String(row.user_key).split('::')[0]);
      if (row.author_type === 'user' && row.author_id) owners.push(String(row.author_id));
    }
  assertMigrationOwnersAllowed(owners, options);
}
