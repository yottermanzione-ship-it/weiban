import assert from 'node:assert/strict';
import test from 'node:test';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
import * as ops from './legacy-migration-preservation.mjs';
import * as server from '../../apps/server/src/platform/migration-preservation.ts';

test('operator and application preservation gates share one fixed policy and canonical identity', () => {
  const synthetic = 'a1000000-0000-4000-8000-000000000001';
  assert.equal(
    ops.legacyMigrationOwnerDigest(synthetic),
    server.legacyMigrationOwnerDigest(synthetic),
  );
  assert.equal(
    ops.legacyMigrationOwnerDigest(synthetic.toUpperCase()),
    server.legacyMigrationOwnerDigest(synthetic),
  );
  for (const digest of policy.userIdSha256) {
    assert.equal(ops.isLegacyMigrationOwnerDigestPreserved(digest, []), true);
    assert.equal(server.isLegacyMigrationOwnerDigestPreserved(digest, []), true);
  }
  for (const gate of [ops, server]) {
    assert.throws(
      () =>
        gate.assertLegacyMigrationOwnerAllowed(synthetic, [
          gate.legacyMigrationOwnerDigest(synthetic),
        ]),
      { message: 'LEGACY_MIGRATION_OWNER_PRESERVED' },
    );
    assert.equal(gate.isLegacyMigrationOwnerPreserved(synthetic), false);
  }
});
