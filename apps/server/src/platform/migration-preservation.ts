/** Migration-only opt-out. Ordinary new-site account use is deliberately unaffected. */
import { createHash } from 'node:crypto';
import policy from './migration-preservation-policy.json' with { type: 'json' };

if (policy.version !== 1 || policy.userIdSha256.some((value) => !/^[a-f0-9]{64}$/.test(value)))
  throw new Error('LEGACY_MIGRATION_PRESERVATION_POLICY_INVALID');
const preserved = new Set(policy.userIdSha256);

export function legacyMigrationOwnerDigest(userId: string): string {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('LEGACY_MIGRATION_OWNER_REQUIRED');
  return createHash('sha256').update(`user:${userId.trim().toLowerCase()}`, 'utf8').digest('hex');
}

/** Additional exclusions may only strengthen the fixed manager decision, never replace it. */
export function isLegacyMigrationOwnerDigestPreserved(
  digest: string,
  additional: readonly string[] = [],
): boolean {
  return preserved.has(digest) || additional.includes(digest);
}

export function isLegacyMigrationOwnerPreserved(
  userId: string,
  additional: readonly string[] = [],
): boolean {
  return isLegacyMigrationOwnerDigestPreserved(legacyMigrationOwnerDigest(userId), additional);
}

export function assertLegacyMigrationOwnerAllowed(
  userId: string,
  additional: readonly string[] = [],
): void {
  if (isLegacyMigrationOwnerPreserved(userId, additional))
    throw new Error('LEGACY_MIGRATION_OWNER_PRESERVED');
}
