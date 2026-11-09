/** Same immutable manager decision as the server; no account names or clear IDs are stored. */
import { createHash } from 'node:crypto';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };

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
