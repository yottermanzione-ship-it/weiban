/** Isolated-only structured persona rehearsal. No production connection discovery or CLI import. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import { assertLegacyMigrationOwnerAllowed } from './legacy-migration-preservation.mjs';

export async function applyLegacyPersonaFixture({
  database,
  target,
  service,
  userId,
  items,
  maintenance,
  options = {},
}) {
  assertLegacyMigrationOwnerAllowed(userId, options.additionalPreservedOwnerDigests);
  if (!Array.isArray(items)) throw new Error('LEGACY_PERSONA_BATCH_REQUIRED');
  for (const item of items)
    assertLegacyMigrationOwnerAllowed(
      item.sourceAccountId,
      options.additionalPreservedOwnerDigests,
    );
  await assertFixtureDatabase(database, target);
  if (service?.database !== database) throw new Error('LEGACY_PERSONA_DATABASE_MISMATCH');
  if (maintenance?.writersStopped !== true || maintenance?.notificationsCaptured !== true)
    throw new Error('LEGACY_PERSONA_MAINTENANCE_REQUIRED');
  return service.importBatch(userId, items, options);
}
export function legacyPersonaPreparation() {
  return {
    mode: 'plan-only',
    productionExecutable: false,
    format: 'weiban-legacy-persona-v1',
    order: [
      'owner-preservation',
      'source-owner-and-exact-base',
      'personal-target-baseline',
      'classification-review',
      'isolated-import',
      'owner-runtime-and-reset-verification',
    ],
    invariant:
      'Public character cards and attachments remain unchanged; source reset and personal target changes cannot be overwritten.',
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--plan'))
    throw new Error('NO_PRODUCTION_EXECUTION_ADAPTER');
  process.stdout.write(JSON.stringify(legacyPersonaPreparation(), null, 2) + '\n');
}
