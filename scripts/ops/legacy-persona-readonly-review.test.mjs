import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { collectPersonaReadOnlyReview } from './legacy-persona-readonly-review.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
test('fixed readers receive read-only transactions, excluded owners never reach payload SQL, and result is aggregate only', async () => {
  const owner = randomUUID(),
    excluded = randomUUID(),
    character = randomUUID();
  const canary = 'PRIVATE_SYNTHETIC_CANARY';
  const base = JSON.stringify({
    id: 'synthetic-role',
    name: 'Synthetic role',
    raw_persona: { soulspec: { personality_core: 'public' } },
  });
  let oldCalls = 0,
    newCalls = 0;
  const readLegacy = (q) => {
    assert.match(q, /^PRAGMA query_only=ON;\nBEGIN;/);
    assert.match(q, /ROLLBACK;\n$/);
    assert.doesNotMatch(q, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH)\b/i);
    if (++oldCalls === 1)
      return [
        JSON.stringify({ userId: owner, rows: 1 }),
        JSON.stringify({ userId: excluded, rows: 2 }),
      ].join('\n');
    assert.equal(q.includes(excluded), false);
    assert.ok(q.includes(owner));
    return JSON.stringify({
      userId: owner,
      personaName: 'Synthetic role',
      version: 1,
      state: 'customized',
      baseSignature: createHash('sha256').update('base').digest('hex'),
      baseRevision: 'r1',
      updatedAt: '2026-11-08T00:00:00Z',
      patchJson: JSON.stringify({ raw_persona: { soulspec: { personality_core: canary } } }),
      baseCount: 1,
      basePackageJson: base,
    });
  };
  const readTarget = (q) => {
    assert.match(q, /^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    assert.match(q, /ROLLBACK;\n$/);
    assert.doesNotMatch(q, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/i);
    if (++newCalls === 1) return JSON.stringify({ personalTable: false });
    return JSON.stringify({
      legacyId: 'synthetic-role',
      target: {
        ownerUserId: owner,
        characterId: character,
        accountActive: true,
        contactActive: true,
        hasPersonalChanges: false,
        classification: {
          basis: 'original',
          realPersonKind: null,
          ageSetting: 'adult',
          childAppearance: false,
        },
        legacyCard: {
          id: 'synthetic-role',
          core_persona: 'public',
          raw_json: { soulspec: { personality_core: 'public' } },
        },
        lorebook: [],
        examples: [],
      },
    });
  };
  const result = await collectPersonaReadOnlyReview({
    readLegacy,
    readTarget,
    cutoff: '2026-11-09T00:00:00Z',
    options: { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(excluded)] },
  });
  assert.equal(result.sourceRows, 3);
  assert.equal(result.preservedRows, 2);
  assert.equal(result.reviewedRows, 1);
  assert.equal(result.projectionCounts.candidate_projection_verified, 1);
  assert.equal(result.productionReady, false);
  for (const secret of [owner, excluded, character, canary, 'Synthetic role'])
    assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(oldCalls, 2);
  assert.equal(newCalls, 2);
});
test('foreign or malformed scope is refused before any private query', async () => {
  let called = 0;
  await assert.rejects(
    () =>
      collectPersonaReadOnlyReview({
        cutoff: '2026-11-09T00:00:00Z',
        readLegacy: () => {
          called++;
          return '{"userId":"not-an-id","rows":1}';
        },
        readTarget: () => {
          throw new Error('must not run');
        },
      }),
    /READ_ONLY_REVIEW_INPUT_INVALID/,
  );
  assert.equal(called, 1);
});
