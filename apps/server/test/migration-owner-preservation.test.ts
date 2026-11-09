import 'reflect-metadata';
import { expect, it } from 'vitest';
import { LegacyFavoritesService } from '../src/modules/library/testing.js';
import { LegacyGroupMemoryService } from '../src/modules/ai-runtime/testing.js';
import { legacyMigrationOwnerDigest } from '../src/platform/index.js';

it('the preserved account exposes no old phone source and cannot reach any favorite or group import dependency', async () => {
  const owner = 'a1000000-0000-4000-8000-000000000002';
  const extra = [legacyMigrationOwnerDigest(owner)];
  let dependencyAccesses = 0;
  const forbidden = new Proxy(
    {},
    {
      get() {
        dependencyAccesses++;
        throw new Error('DEPENDENCY_SENTINEL');
      },
    },
  );
  const favorites = new LegacyFavoritesService(
    ...(Array.from({ length: 6 }, () => forbidden) as unknown as ConstructorParameters<
      typeof LegacyFavoritesService
    >),
  );
  const group = new LegacyGroupMemoryService(
    ...(Array.from({ length: 7 }, () => forbidden) as unknown as ConstructorParameters<
      typeof LegacyGroupMemoryService
    >),
  );
  await expect(favorites.source(owner, extra)).resolves.toEqual({
    userId: owner,
    legacyAccountKeys: [],
    available: false,
  });
  await expect(favorites.import(owner, { synthetic: true }, extra)).rejects.toMatchObject({
    code: 'forbidden',
  });
  await expect(group.importBatch(owner, { synthetic: true }, extra)).rejects.toThrow(
    'LEGACY_MIGRATION_OWNER_PRESERVED',
  );
  expect(dependencyAccesses).toBe(0);
  // The extra rehearsal exclusion is confined to these calls; other new-site users
  // still follow the normal service path, whose behavior has its own integration suite.
  await expect(favorites.source(owner)).rejects.toThrow('DEPENDENCY_SENTINEL');
  expect(dependencyAccesses).toBe(1);
});
