import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyTextSupplement,
  preflightLegacyTextSupplements,
} from './legacy-customization-shape.mjs';

const row = (patch) => ({ state: 'customized', patch_json: JSON.stringify(patch) });

test('plain historical text remains intact within the actual supplement limit', () => {
  assert.equal(legacyTextSupplement(row({ raw_persona: '  合成设定\u0000。  ' })), '合成设定。');
  assert.equal(legacyTextSupplement(row({ raw_persona: 'x'.repeat(5000) })).length, 5000);
  assert.throws(() => legacyTextSupplement(row({ raw_persona: 'x'.repeat(5001) })), {
    message: 'LEGACY_SUPPLEMENT_TOO_LONG',
  });
});

test('structured persona, lorebook, examples and null deletions never become lossy strings', () => {
  for (const value of [
    { character: { personality: 'synthetic-private-value' } },
    { lorebook: [{ key: 'synthetic', content: 'synthetic-private-value' }] },
    { examples: [{ user: 'synthetic', assistant: 'synthetic-private-value' }] },
    { character: null },
    null,
    12,
    ['synthetic-private-value'],
  ]) {
    assert.throws(() => legacyTextSupplement(row({ raw_persona: value })), {
      message: 'LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED',
    });
  }
});

test('additional edited fields cannot disappear even when raw_persona is a string', () => {
  for (const patch of [
    { raw_persona: 'synthetic', legacy_fields: { description: 'synthetic-private-value' } },
    { legacy_fields: { examples: ['synthetic-private-value'] } },
    { raw_persona: 'synthetic', unknown_extension: 'synthetic-private-value' },
    { raw_persona: 'synthetic', legacy_fields: null },
  ])
    assert.throws(() => legacyTextSupplement(row(patch)), {
      message: 'LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED',
    });
  assert.equal(
    legacyTextSupplement(row({ raw_persona: 'synthetic', legacy_fields: {} })),
    'synthetic',
  );
});

test('reset and empty no-op rows remain no-ops without restoring a backup', () => {
  assert.equal(legacyTextSupplement({ state: 'reset', patch_json: 'unread-synthetic' }), null);
  assert.equal(legacyTextSupplement(row({})), null);
  assert.equal(legacyTextSupplement(row({ raw_persona: '  ' })), null);
});

test('invalid shapes stop with fixed categories and never echo private data', () => {
  for (const value of [null, [], 'synthetic-private-value', 42])
    assert.throws(() => legacyTextSupplement(row(value)), {
      message: 'LEGACY_CUSTOMIZATION_OBJECT_REQUIRED',
    });
  assert.throws(
    () => legacyTextSupplement({ state: 'customized', patch_json: 'synthetic-private-value' }),
    {
      message: 'LEGACY_CUSTOMIZATION_INVALID_JSON',
    },
  );
});

test('the complete preflight rejects a later unsupported row before any caller write', () => {
  let writes = 0;
  const run = () => {
    preflightLegacyTextSupplements([
      row({ raw_persona: 'supported' }),
      row({ raw_persona: { lorebook: [] } }),
    ]);
    writes++;
  };
  assert.throws(run, { message: 'LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED' });
  assert.equal(writes, 0);
  assert.throws(() => preflightLegacyTextSupplements({}), {
    message: 'LEGACY_CUSTOMIZATION_ROWS_REQUIRED',
  });
});
