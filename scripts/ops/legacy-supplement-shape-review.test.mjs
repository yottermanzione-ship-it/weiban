import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inspectSupplementShapes } from './legacy-supplement-shape-review.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
test('decrypted buffers are cleared; only fixed categories leave the reader; preserved owner never queries', async () => {
  const excluded = randomUUID(),
    owner = randomUUID(),
    refs = Array.from({ length: 5 }, (_, index) => ({
      index,
      userId: index === 4 ? excluded : owner,
      characterId: randomUUID(),
      sourceUpdatedAt: '2026-10-20T00:00:00Z',
    }));
  const texts = ['[object Object]', '[object Object]', 'PRIVATE_SYNTHETIC_CANARY', ''];
  const buffers = [];
  let queries = 0;
  const reader = {
    query: async (sql, values) => {
      assert.match(sql, /^SELECT /);
      assert.equal(values[0], owner);
      const i = queries++;
      return {
        rows: [
          {
            text_ciphertext: Buffer.from(String(i)),
            updated_at: i === 1 ? '2026-11-01T00:00:00Z' : '2026-10-20T00:00:00Z',
          },
        ],
      };
    },
  };
  const crypto = {
    open: async (_owner, _aad, sealed, tx) => {
      assert.equal(tx, reader);
      const b = Buffer.from(texts[Number(sealed)]);
      buffers.push(b);
      return b;
    },
  };
  const result = await inspectSupplementShapes(reader, crypto, refs, [
    legacyMigrationOwnerDigest(excluded),
  ]);
  assert.deepEqual(
    result.map((r) => r.kind),
    [
      'placeholder_before_first_cutoff',
      'placeholder_after_or_unknown',
      'other_text',
      'empty',
      'preserved_owner',
    ],
  );
  assert.equal(queries, 4);
  assert.ok(buffers.every((b) => b.every((v) => v === 0)));
  for (const value of [owner, excluded, 'PRIVATE_SYNTHETIC_CANARY', '[object Object]'])
    assert.equal(JSON.stringify(result).includes(value), false);
});
