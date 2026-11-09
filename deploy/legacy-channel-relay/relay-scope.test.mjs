import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { relayScopeExclusion, assertRelayScope, allowedRelayExclusions } from './relay-scope.mjs';
const userId = '11111111-1111-4111-8111-111111111111',
  cutoverAt = '2026-11-09T14:00:00.000Z';
test('cutover scope excludes all weibo and expired/equal-cutoff wechat, keeps valid final membership and QQ', () => {
  assert.equal(
    relayScopeExclusion({ userId, channel: 'weibo', cutoverAt }, '2099-01-01T00:00:00Z'),
    'manager_skip_weibo',
  );
  for (const until of [null, '2026-01-01T00:00:00Z', cutoverAt])
    assert.equal(
      relayScopeExclusion({ userId, channel: 'wechat', cutoverAt }, until),
      'membership_expired',
    );
  assert.equal(
    relayScopeExclusion({ userId, channel: 'wechat', cutoverAt }, '2027-01-01T00:00:00Z'),
    null,
  );
  assert.equal(relayScopeExclusion({ userId, channel: 'qq', cutoverAt }, null), null);
  assert.equal(
    relayScopeExclusion(
      { userId, channel: 'wechat', cutoverAt },
      '2099-01-01T00:00:00Z',
      () => true,
    ),
    'preserved_existing_account',
  );
});
test('apply/enable scope rejects unauthorized old weibo plans and rechecks current membership', async () => {
  let called = 0;
  const tx = {
    query: async () => {
      called++;
      return { rows: [{ pro_plus_until: '2026-01-01T00:00:00Z' }] };
    },
  };
  await assert.rejects(
    assertRelayScope(tx, { userId, channel: 'weibo', cutoverAt }),
    /NOT_AUTHORIZED/,
  );
  assert.equal(called, 0);
  await assert.rejects(
    assertRelayScope(tx, { userId, channel: 'wechat', cutoverAt }),
    /MEMBERSHIP_EXPIRED/,
  );
  assert.equal(called, 1);
  assert.equal(allowedRelayExclusions.has('existing_direct_dependency_missing'), false);
  assert.equal(allowedRelayExclusions.has('preset_character_unmapped'), false);
  assert.equal(allowedRelayExclusions.has('membership_expired'), true);
});
test('legacy exporter preservation policy is identical to the canonical fixed policy', () => {
  const read = (url) => JSON.parse(fs.readFileSync(url, 'utf8'));
  assert.deepEqual(
    read(new URL('./preservation-policy.json', import.meta.url)),
    read(
      new URL('../../apps/server/src/platform/migration-preservation-policy.json', import.meta.url),
    ),
  );
});
