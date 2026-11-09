/** Group-shared fixture adapter. No production connection discovery or execution CLI. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import { assertMigrationOwnersAllowed } from './legacy-migration-owner-guards.mjs';

export async function applySharedGroupMemoryFixture({
  database,
  target,
  service,
  input,
  maintenance,
  options = {},
}) {
  assertMigrationOwnersAllowed([input?.sourceAccountId], options);
  await assertFixtureDatabase(database, target);
  if (service?.database !== database) throw new Error('GROUP_MEMORY_SERVICE_DATABASE_MISMATCH');
  if (maintenance?.writersStopped !== true || maintenance?.notificationsCaptured !== true)
    throw new Error('GROUP_MEMORY_MAINTENANCE_REQUIRED');
  return service.importBatch(input.sourceAccountId, input, options);
}
export const sharedGroupMemoryPreparation = () => ({
  mode: 'plan-only',
  format: 'weiban-legacy-shared-group-memory-v1',
  productionExecutable: false,
  ownership: 'Verified source account plus original group; no per-character fanout.',
  evidence: [
    'complete source snapshot',
    'verified owner/group mapping',
    'normal scope',
    'deletion review',
    'forget review',
  ],
  usage:
    'Choose whole entries within 2400 UTF-8 bytes from the original latest 30 enabled records, ordinary replies in that same group only.',
  blocked:
    'Disabled, archived, missing evidence, private health, changed target or source, and user deletion remain protected.',
});
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--plan'))
    throw new Error('NO_PRODUCTION_EXECUTION_ADAPTER');
  process.stdout.write(JSON.stringify(sharedGroupMemoryPreparation(), null, 2) + '\n');
}
