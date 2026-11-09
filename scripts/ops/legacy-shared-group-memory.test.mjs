import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  applySharedGroupMemoryFixture,
  sharedGroupMemoryPreparation,
} from './legacy-shared-group-memory.mjs';

const url = 'postgres://postgres@127.0.0.1:56389/codex_migration_group_scope_1109';
const target = { kind: 'isolated-fixture', synthetic: true, url };
function fixture() {
  const calls = [];
  const database = {
    pool: { options: { connectionString: url } },
    query: async (sql) => {
      calls.push(sql);
      return {
        rows: sql.includes('current_database')
          ? [{ name: 'codex_migration_group_scope_1109' }]
          : [{ synthetic: true }],
      };
    },
  };
  let imports = 0;
  const service = {
    database,
    importBatch: async () => {
      imports++;
      return { synthetic: true };
    },
  };
  return {
    database,
    service,
    calls,
    input: { sourceAccountId: 'synthetic-fixture-owner' },
    imports: () => imports,
  };
}
test('default CLI is planning only; execution flags are rejected', () => {
  assert.equal(sharedGroupMemoryPreparation().productionExecutable, false);
  const planned = spawnSync(process.execPath, ['scripts/ops/legacy-shared-group-memory.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(planned.status, 0);
  assert.equal(JSON.parse(planned.stdout).mode, 'plan-only');
  const execution = spawnSync(
    process.execPath,
    ['scripts/ops/legacy-shared-group-memory.mjs', '--execute'],
    { encoding: 'utf8' },
  );
  assert.notEqual(execution.status, 0);
  assert.match(execution.stderr, /NO_PRODUCTION_EXECUTION_ADAPTER/);
});
test('non-loopback and shared database refused before the first query', async () => {
  for (const badUrl of [
    'postgres://postgres@example.invalid:5432/codex_migration_group_scope_1109',
    'postgres://postgres@127.0.0.1:56389/weiban',
  ]) {
    const f = fixture();
    await assert.rejects(
      applySharedGroupMemoryFixture({ ...f, target: { ...target, url: badUrl } }),
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.imports(), 0);
  }
});
test('connection mismatch and false synthetic marker refuse import', async () => {
  const f = fixture();
  f.database.pool.options.connectionString += '_wrong';
  await assert.rejects(
    applySharedGroupMemoryFixture({ ...f, target }),
    /DATABASE_CONNECTION_MISMATCH/,
  );
  assert.equal(f.calls.length, 0);
  const g = fixture();
  g.database.query = async (sql) => ({
    rows: sql.includes('current_database')
      ? [{ name: 'codex_migration_group_scope_1109' }]
      : [{ synthetic: false }],
  });
  await assert.rejects(
    applySharedGroupMemoryFixture({ ...g, target }),
    /SYNTHETIC_DATABASE_MARKER_REQUIRED/,
  );
  assert.equal(g.imports(), 0);
});
test('service database binding and maintenance evidence are mandatory', async () => {
  const f = fixture();
  await assert.rejects(
    applySharedGroupMemoryFixture({ ...f, service: { ...f.service, database: {} }, target }),
    /SERVICE_DATABASE_MISMATCH/,
  );
  await assert.rejects(
    applySharedGroupMemoryFixture({ ...f, target, maintenance: { writersStopped: true } }),
    /MAINTENANCE_REQUIRED/,
  );
  assert.equal(f.imports(), 0);
});
test('only checked isolated adapter delegates a synthetic batch once', async () => {
  const f = fixture();
  assert.deepEqual(
    await applySharedGroupMemoryFixture({
      ...f,
      target,
      input: { sourceAccountId: 'synthetic' },
      maintenance: { writersStopped: true, notificationsCaptured: true },
    }),
    { synthetic: true },
  );
  assert.equal(f.imports(), 1);
  assert.equal(f.calls.length, 2);
});
