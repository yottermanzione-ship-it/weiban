/** Protected source mappings for the Android bridge. Isolated execution only; never infer
 * ownership from the current display name, current alias, device claim or unscoped preferences. */
import { createHash } from 'node:crypto';
import { fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';

const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
export const legacyFavoriteReferenceHash = sha;

export async function readFavoriteSourceBaseline({ database, target, userIds }) {
  await assertFixtureDatabase(database, target);
  const ids = [...new Set(userIds)].sort();
  const users = (
    await database.query(
      'SELECT id,status,username FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id',
      [ids],
    )
  ).rows;
  // account_key is globally unique: another account may already own one of these old partitions.
  const sources = (
    await database.query(
      'SELECT * FROM library.legacy_favorite_sources ORDER BY user_id,account_key',
    )
  ).rows;
  const media = (
    await database.query(
      'SELECT * FROM library.legacy_favorite_media_links WHERE user_id=ANY($1::uuid[]) ORDER BY user_id,reference_hash,kind',
      [ids],
    )
  ).rows;
  return { userIds: ids, users, sources, media };
}

export function planFavoriteSources({
  baseline,
  sourceAccounts,
  mediaBindings = [],
  sourceSnapshotDigest,
  sourceBatch,
  cutoff,
  deletedUserIds = [],
  inventoryComplete,
}) {
  invariant(inventoryComplete === true, 'FAVORITE_SOURCE_INVENTORY_REQUIRED');
  invariant(/^[a-f0-9]{64}$/.test(sourceSnapshotDigest ?? ''), 'VERIFIED_SNAPSHOT_DIGEST_REQUIRED');
  invariant(
    typeof sourceBatch === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(sourceBatch),
    'SOURCE_BATCH_REQUIRED',
  );
  const at = utc(cutoff),
    users = new Map(baseline.users.map((row) => [row.id, row]));
  const existingKeys = new Map(baseline.sources.map((row) => [row.account_key, row.user_id]));
  const deleted = new Set(deletedUserIds),
    insert = [],
    links = [],
    conflicts = [];
  const seenUsers = new Set();
  for (const source of sourceAccounts) {
    invariant(!seenUsers.has(source.userId), 'DUPLICATE_SOURCE_ACCOUNT');
    seenUsers.add(source.userId);
    const accountKey =
      typeof source.username === 'string' ? source.username.trim().toLowerCase() : '';
    if (
      !/^[a-z0-9]{4,20}$/.test(accountKey) ||
      source.identityVerified !== true ||
      source.sourceUserId !== source.userId
    ) {
      conflicts.push({ userId: source.userId, reason: 'unverified_legacy_partition' });
      continue;
    }
    const user = users.get(source.userId);
    if (!user || user.status !== 'active' || deleted.has(source.userId)) {
      conflicts.push({ userId: source.userId, reason: 'owner_missing_or_deleted' });
      continue;
    }
    const owner = existingKeys.get(accountKey);
    if (owner && owner !== source.userId) {
      conflicts.push({ userId: source.userId, reason: 'legacy_partition_owned_by_other_account' });
      continue;
    }
    if (!owner && [...existingKeys.values()].filter((id) => id === source.userId).length >= 8) {
      conflicts.push({ userId: source.userId, reason: 'too_many_legacy_partitions' });
      continue;
    }
    if (!owner) {
      insert.push({ userId: source.userId, accountKey, sourceUserId: source.sourceUserId });
      existingKeys.set(accountKey, source.userId);
    }
  }
  const oldLinks = new Map(
    baseline.media.map((row) => [
      row.user_id + ':' + row.reference_hash + ':' + row.kind,
      row.media_id,
    ]),
  );
  for (const binding of mediaBindings) {
    const allowed =
      binding.kind === 'voice'
        ? ['chat_voice', 'generated_voice']
        : binding.kind === 'image'
          ? ['chat_image', 'user_sticker', 'moments_image']
          : [];
    const ready = binding.ready;
    if (
      !ready ||
      users.get(binding.userId)?.status !== 'active' ||
      deleted.has(binding.userId) ||
      ready.ownerUserId !== binding.userId ||
      !allowed.includes(ready.purpose) ||
      !/^[a-f0-9]{64}$/.test(ready.contentHash ?? '') ||
      typeof binding.reference !== 'string' ||
      !binding.reference ||
      binding.reference.length > 4096
    ) {
      conflicts.push({ userId: binding.userId, reason: 'media_owner_or_verification_missing' });
      continue;
    }
    const referenceHash = sha(binding.reference),
      key = binding.userId + ':' + referenceHash + ':' + binding.kind;
    if (oldLinks.has(key) && oldLinks.get(key) !== ready.id) {
      conflicts.push({ userId: binding.userId, reason: 'media_reference_conflict' });
      continue;
    }
    if (!oldLinks.has(key)) {
      links.push({ userId: binding.userId, referenceHash, kind: binding.kind, mediaId: ready.id });
      oldLinks.set(key, ready.id);
    }
  }
  const payload = {
    version: 1,
    baseline: fingerprint(baseline),
    userIds: baseline.userIds,
    sourceSnapshotDigest,
    sourceBatch,
    at,
    insert,
    links,
    conflicts,
  };
  return {
    ...payload,
    digest: fingerprint(payload),
    summary: {
      sourcePartitions: insert.length,
      mediaLinks: links.length,
      conflicts: conflicts.length,
    },
  };
}

export async function applyFavoriteSources({ database, target, plan, maintenance, mediaPort }) {
  await assertFixtureDatabase(database, target);
  invariant(maintenance?.writersStopped === true, 'MAINTENANCE_REQUIRED');
  const { digest, summary: _summary, ...payload } = plan;
  invariant(
    fingerprint(payload) === digest && plan.conflicts.length === 0,
    'FAVORITE_SOURCE_PLAN_REQUIRES_REVIEW',
  );
  // MediaSystemPort has no Tx parameter. Validate outside the account-lock transaction;
  // the maintenance writer gate is mandatory and media ownership is immutable.
  for (const row of plan.links) {
    const purposes =
      row.kind === 'voice'
        ? ['chat_voice', 'generated_voice']
        : ['chat_image', 'user_sticker', 'moments_image'];
    invariant(
      mediaPort && (await mediaPort.canUse(row.userId, row.mediaId, purposes)),
      'FAVORITE_MEDIA_NOT_OWNED_OR_READY',
    );
  }
  return database.transaction(async (tx) => {
    await tx.query(
      'LOCK TABLE library.legacy_favorite_sources,library.legacy_favorite_media_links IN SHARE ROW EXCLUSIVE MODE',
    );
    const repeated = await tx.query(
      'SELECT 1 FROM public.codex_migration_favorite_source_receipts WHERE digest=$1',
      [digest],
    );
    if (repeated.rows.length) return { status: 'already_applied', sources: 0, mediaLinks: 0 };
    // Read the frozen source ownership baseline again on this connection.
    const users = (
      await tx.query(
        'SELECT id,status,username FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [plan.userIds],
      )
    ).rows;
    const sources = (
      await tx.query('SELECT * FROM library.legacy_favorite_sources ORDER BY user_id,account_key')
    ).rows;
    const media = (
      await tx.query(
        'SELECT * FROM library.legacy_favorite_media_links WHERE user_id=ANY($1::uuid[]) ORDER BY user_id,reference_hash,kind',
        [plan.userIds],
      )
    ).rows;
    invariant(
      fingerprint({ userIds: plan.userIds, users, sources, media }) === plan.baseline,
      'FAVORITE_SOURCE_TARGET_CHANGED',
    );
    for (const row of plan.insert)
      await tx.query(
        'INSERT INTO library.legacy_favorite_sources(user_id,account_key,source_user_id,source_batch,verified_at) VALUES($1,$2,$1,$3,$4)',
        [row.userId, row.accountKey, plan.sourceBatch, plan.at],
      );
    for (const row of plan.links) {
      await tx.query(
        'INSERT INTO library.legacy_favorite_media_links(user_id,reference_hash,kind,media_id,source_batch) VALUES($1,$2,$3,$4,$5)',
        [row.userId, row.referenceHash, row.kind, row.mediaId, plan.sourceBatch],
      );
    }
    await tx.query(
      'INSERT INTO public.codex_migration_favorite_source_receipts(digest) VALUES($1)',
      [digest],
    );
    return { status: 'applied', sources: plan.insert.length, mediaLinks: plan.links.length };
  });
}

export async function initializeFavoriteSourceFixture({ database, target }) {
  await assertFixtureDatabase(database, target);
  await database.query(
    'CREATE TABLE IF NOT EXISTS public.codex_migration_favorite_source_receipts(digest text PRIMARY KEY)',
  );
}
