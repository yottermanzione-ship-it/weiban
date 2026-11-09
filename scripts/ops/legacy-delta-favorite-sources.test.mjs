import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { openLab, addFixtureUser, cutoff, maintenance } from './legacy-delta-lab.mjs';
import { fingerprint, invariant } from './legacy-delta-core.mjs';
import {
  planFavoriteSources,
  readFavoriteSourceBaseline,
  initializeFavoriteSourceFixture,
  applyFavoriteSources,
} from './legacy-delta-favorite-sources.mjs';

const owner = randomUUID(),
  other = randomUUID();
const baseline = {
  userIds: [owner],
  users: [{ id: owner, status: 'active', username: 'newalias' }],
  sources: [],
  media: [],
};
const source = { userId: owner, sourceUserId: owner, username: 'oldname', identityVerified: true };
const plan = (extra = {}) =>
  planFavoriteSources({
    baseline,
    sourceAccounts: [source],
    sourceSnapshotDigest: fingerprint('synthetic'),
    sourceBatch: 'synthetic-favorites',
    cutoff,
    inventoryComplete: true,
    ...extra,
  });

test('必须是已核实旧ID映射，不按新昵称或客户端自报分区归属', () => {
  assert.equal(plan().insert[0].accountKey, 'oldname');
  assert.equal(
    plan({ sourceAccounts: [{ ...source, identityVerified: false }] }).conflicts.length,
    1,
  );
  assert.equal(plan({ sourceAccounts: [{ ...source, sourceUserId: other }] }).conflicts.length, 1);
  assert.equal(plan({ deletedUserIds: [owner] }).conflicts.length, 1);
});
test('重名旧分区、过多分区和无验证媒体禁止挂到账号', () => {
  assert.equal(
    plan({ baseline: { ...baseline, sources: [{ account_key: 'oldname', user_id: other }] } })
      .conflicts.length,
    1,
  );
  assert.equal(
    plan({
      baseline: {
        ...baseline,
        sources: Array.from({ length: 8 }, (_, n) => ({ account_key: 'name' + n, user_id: owner })),
      },
    }).conflicts.length,
    1,
  );
  assert.equal(
    plan({
      mediaBindings: [
        {
          userId: owner,
          kind: 'image',
          reference: '/synthetic.png',
          ready: {
            id: randomUUID(),
            ownerUserId: other,
            purpose: 'chat_image',
            contentHash: fingerprint('bytes'),
          },
        },
      ],
    }).conflicts.length,
    1,
  );
});

const url = process.env.MIGRATION_FAVORITE_SOURCES_DATABASE_URL;
invariant(url, 'MIGRATION_FAVORITE_SOURCES_DATABASE_URL_REQUIRED');
let lab, user;
before(async () => {
  lab = await openLab(url);
  await initializeFavoriteSourceFixture(lab);
  user = await addFixtureUser(lab);
});
after(async () => {
  await lab?.close();
});
const pending = async () => {
  const current = await readFavoriteSourceBaseline({ ...lab, userIds: [user.id] });
  return planFavoriteSources({
    baseline: current,
    sourceAccounts: [
      {
        ...source,
        userId: user.id,
        sourceUserId: user.id,
        username: 'old' + user.id.replaceAll('-', '').slice(0, 12),
      },
    ],
    sourceSnapshotDigest: fingerprint('synthetic'),
    sourceBatch: 'synthetic-favorites',
    cutoff,
    inventoryComplete: true,
  });
};
test('真实来源表同计划重跑只写一次，客户端不能借昵称绑定', async () => {
  const next = await pending();
  assert.equal((await applyFavoriteSources({ ...lab, plan: next, maintenance })).sources, 1);
  assert.equal(
    (await applyFavoriteSources({ ...lab, plan: next, maintenance })).status,
    'already_applied',
  );
  const rows = (
    await lab.database.query(
      'SELECT user_id,source_user_id,account_key FROM library.legacy_favorite_sources WHERE user_id=$1',
      [user.id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, rows[0].source_user_id);
});
test('真实目标变动拒绝旧计划，缺媒体实际归属证明不写映射', async () => {
  const next = await pending();
  await lab.database.query('UPDATE identity.users SET username=$2 WHERE id=$1', [
    user.id,
    'changed_' + user.id.replaceAll('-', '').slice(0, 10),
  ]);
  await assert.rejects(applyFavoriteSources({ ...lab, plan: next, maintenance }), /TARGET_CHANGED/);
  const current = await readFavoriteSourceBaseline({ ...lab, userIds: [user.id] });
  const draft = planFavoriteSources({
    baseline: current,
    sourceAccounts: [],
    mediaBindings: [
      {
        userId: user.id,
        kind: 'voice',
        reference: '/synthetic.wav',
        ready: {
          id: randomUUID(),
          ownerUserId: user.id,
          purpose: 'chat_voice',
          contentHash: fingerprint('bytes'),
        },
      },
    ],
    sourceSnapshotDigest: fingerprint('synthetic'),
    sourceBatch: 'synthetic-favorites',
    cutoff,
    inventoryComplete: true,
  });
  await assert.rejects(
    applyFavoriteSources({
      ...lab,
      plan: draft,
      maintenance,
      mediaPort: { canUse: async () => false },
    }),
    /NOT_OWNED/,
  );
  assert.equal(
    Number(
      (
        await lab.database.query(
          'SELECT count(*) AS n FROM library.legacy_favorite_media_links WHERE user_id=$1',
          [user.id],
        )
      ).rows[0].n,
    ),
    0,
  );
});
