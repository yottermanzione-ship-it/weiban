import { describe, expect, it } from 'vitest';
import policy from './migration-preservation-policy.json' with { type: 'json' };
import {
  assertLegacyMigrationOwnerAllowed,
  isLegacyMigrationOwnerDigestPreserved,
  isLegacyMigrationOwnerPreserved,
  legacyMigrationOwnerDigest,
} from './migration-preservation.js';

describe('migration-only account preservation', () => {
  const synthetic = 'a1000000-0000-4000-8000-000000000001';
  it('the fixed decision cannot be removed by an empty additional exclusion list', () => {
    expect(policy.userIdSha256.length).toBeGreaterThan(0);
    expect(isLegacyMigrationOwnerDigestPreserved(policy.userIdSha256[0]!, [])).toBe(true);
    expect(isLegacyMigrationOwnerPreserved(synthetic)).toBe(false);
  });
  it('synthetic exclusions reject before the writer and never echo an account identity', () => {
    const extra = [legacyMigrationOwnerDigest(synthetic)];
    let writes = 0;
    expect(() => {
      assertLegacyMigrationOwnerAllowed(synthetic.toUpperCase(), extra);
      writes++;
    }).toThrow('LEGACY_MIGRATION_OWNER_PRESERVED');
    expect(writes).toBe(0);
    expect(() => assertLegacyMigrationOwnerAllowed('')).toThrow('LEGACY_MIGRATION_OWNER_REQUIRED');
  });
});
