/** Same immutable manager decision as the server; no account names or clear IDs are stored. */
import { createHash } from 'node:crypto';
const policy = {
  version: 1,
  decision: 'preserve-designated-existing-new-site-account',
  decidedAt: '2026-11-09',
  userIdSha256: ['f9bc0494dc27cdcddd75adf14dcc39bdc051f8ff69bf3864d80f40414d2269f1'],
};

if (policy.version !== 1 || policy.userIdSha256.some((value) => !/^[a-f0-9]{64}$/.test(value)))
  throw new Error('LEGACY_MIGRATION_PRESERVATION_POLICY_INVALID');
const preserved = new Set(policy.userIdSha256);

export function legacyMigrationOwnerDigest(userId) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('LEGACY_MIGRATION_OWNER_REQUIRED');
  return createHash('sha256').update(`user:${userId.trim().toLowerCase()}`, 'utf8').digest('hex');
}
export function isLegacyMigrationOwnerDigestPreserved(digest, additional = []) {
  return preserved.has(digest) || additional.includes(digest);
}
export function isLegacyMigrationOwnerPreserved(userId, additional = []) {
  return isLegacyMigrationOwnerDigestPreserved(legacyMigrationOwnerDigest(userId), additional);
}
export function assertLegacyMigrationOwnerAllowed(userId, additional = []) {
  if (isLegacyMigrationOwnerPreserved(userId, additional))
    throw new Error('LEGACY_MIGRATION_OWNER_PRESERVED');
}

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
