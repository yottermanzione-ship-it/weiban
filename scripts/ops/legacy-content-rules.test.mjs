import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacyId,
  legacyTime,
  deletedLegacyMessage,
  splitLegacyText,
  visibleLegacyInteraction,
  legacyNameIndex,
  legacyMessageContents,
} from './legacy-content-rules.mjs';

test('IDs are stable and private media identities differ between users', () => {
  assert.equal(legacyId('message', 1), legacyId('message', 1));
  assert.notEqual(legacyId('media', 'alice', '/x'), legacyId('media', 'bob', '/x'));
  assert.match(legacyId('message', 1), /^[0-9a-f-]{14}5[0-9a-f-]{21}$/);
});
test('empty old deletion timestamps are not treated as deleted', () => {
  assert.equal(deletedLegacyMessage({ deleted_at: '' }), false);
  assert.equal(deletedLegacyMessage({ deleted_at: null }), false);
  assert.equal(deletedLegacyMessage({ deleted_at: '2026-10-20 12:00:00' }), true);
});
test('old UTC dates remain UTC and long text preserves every character without cutting emoji', () => {
  assert.equal(
    legacyTime('2026-10-20 12:00:00', '2026-01-01T00:00:00Z'),
    '2026-10-20T12:00:00.000Z',
  );
  const original = 'a'.repeat(3999) + '😀' + 'b'.repeat(500);
  const parts = splitLegacyText(original);
  assert.equal(parts.join(''), original);
  assert.ok(parts.every((p) => p.length <= 4000));
  assert.equal(parts[0].length, 3999);
});
test('interactions retain the old per-user privacy rule including unowned likes', () => {
  const friends = new Set(['角色A']);
  assert.equal(
    visibleLegacyInteraction({ actor_type: 'user', user_id: 'bob' }, 'alice', friends),
    false,
  );
  assert.equal(
    visibleLegacyInteraction({ actor_type: 'user', user_id: '' }, 'alice', friends),
    false,
  );
  assert.equal(
    visibleLegacyInteraction(
      { actor_type: 'character', actor_name: '角色A', user_id: '' },
      'alice',
      friends,
    ),
    true,
  );
  assert.equal(
    visibleLegacyInteraction(
      { actor_type: 'character', actor_name: '角色B', user_id: '' },
      'alice',
      friends,
    ),
    false,
  );
  assert.equal(
    visibleLegacyInteraction(
      { actor_type: 'character', actor_name: '角色B', user_id: 'alice' },
      'alice',
      friends,
    ),
    true,
  );
});
test('names only resolve when the known identity is unambiguous', () => {
  const lookup = legacyNameIndex([
    { id: 'a', name: '张艺谋', legacy_card: { aliases_json: '["同名"]' } },
    { id: 'b', name: '其他', legacy_card: { aliases_json: '["同名"]' } },
  ]);
  assert.equal(lookup('张艺谋。'), 'a');
  assert.equal(lookup('同名'), null);
});
test('missing media is explicitly labeled rather than inventing a playable object', () => {
  const content = legacyMessageContents({ message_type: 'voice', content: '原来的转写' }, null);
  assert.equal(content[0].type, 'text');
  assert.match(content[0].text, /文件缺失.*原来的转写/);
});
