import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { applyLegacyPersonaFixture, legacyPersonaPreparation } from './legacy-persona-import.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
const owner = '00000000-0000-4000-8000-000000000166';
const url = 'postgres://postgres@127.0.0.1:56389/codex_migration_persona_1109';
const target = { kind: 'isolated-fixture', synthetic: true, url };
function fixture() {
  let reads = 0,
    writes = 0;
  const database = {
    pool: { options: { connectionString: url } },
    query: async (sql) => {
      reads++;
      return {
        rows: sql.includes('current_database')
          ? [{ name: 'codex_migration_persona_1109' }]
          : [{ synthetic: true }],
      };
    },
  };
  const service = {
    database,
    importBatch: async () => {
      writes++;
      return { synthetic: true };
    },
  };
  return {
    database,
    service,
    reads: () => reads,
    writes: () => writes,
    userId: owner,
    target,
    items: [{ sourceAccountId: owner }],
    maintenance: { writersStopped: true, notificationsCaptured: true },
  };
}
test('default CLI only plans and refuses execute', () => {
  assert.equal(legacyPersonaPreparation().productionExecutable, false);
  const plan = spawnSync(process.execPath, ['scripts/ops/legacy-persona-import.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(plan.status, 0);
  assert.equal(JSON.parse(plan.stdout).mode, 'plan-only');
  const execution = spawnSync(
    process.execPath,
    ['scripts/ops/legacy-persona-import.mjs', '--execute'],
    { encoding: 'utf8' },
  );
  assert.notEqual(execution.status, 0);
  assert.match(execution.stderr, /NO_PRODUCTION_EXECUTION_ADAPTER/);
});
test('both actual write owner and source owner exclusions run before the first DB call', async () => {
  const f = fixture();
  await assert.rejects(
    applyLegacyPersonaFixture({
      ...f,
      options: { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(owner)] },
    }),
    /LEGACY_MIGRATION_OWNER_PRESERVED/,
  );
  assert.equal(f.reads(), 0);
  assert.equal(f.writes(), 0);
  const g = fixture(),
    source = '00000000-0000-4000-8000-000000000167';
  await assert.rejects(
    applyLegacyPersonaFixture({
      ...g,
      items: [{ sourceAccountId: source }],
      options: { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(source)] },
    }),
    /LEGACY_MIGRATION_OWNER_PRESERVED/,
  );
  assert.equal(g.reads(), 0);
  assert.equal(g.writes(), 0);
});
test('remote, shared, wrong connection and missing maintenance cannot import', async () => {
  for (const badUrl of [
    'postgres://postgres@example.invalid/codex_migration_persona_1109',
    'postgres://postgres@127.0.0.1:56389/weiban',
  ]) {
    const f = fixture();
    await assert.rejects(applyLegacyPersonaFixture({ ...f, target: { ...target, url: badUrl } }));
    assert.equal(f.reads(), 0);
  }
  const f = fixture();
  f.database.pool.options.connectionString += '_other';
  await assert.rejects(applyLegacyPersonaFixture(f), /DATABASE_CONNECTION_MISMATCH/);
  const g = fixture();
  await assert.rejects(
    applyLegacyPersonaFixture({ ...g, maintenance: {} }),
    /MAINTENANCE_REQUIRED/,
  );
  assert.equal(g.writes(), 0);
});
test('false marker and mismatched service DB are refused; checked fixture delegates once', async () => {
  const f = fixture();
  f.database.query = async (sql) => ({
    rows: sql.includes('current_database')
      ? [{ name: 'codex_migration_persona_1109' }]
      : [{ synthetic: false }],
  });
  await assert.rejects(applyLegacyPersonaFixture(f), /SYNTHETIC_DATABASE_MARKER_REQUIRED/);
  const g = fixture();
  await assert.rejects(
    applyLegacyPersonaFixture({ ...g, service: { ...g.service, database: {} } }),
    /LEGACY_PERSONA_DATABASE_MISMATCH/,
  );
  assert.deepEqual(await applyLegacyPersonaFixture(g), { synthetic: true });
  assert.equal(g.writes(), 1);
});
