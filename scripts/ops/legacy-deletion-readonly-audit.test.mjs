import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  deletionFragmentReview,
  assertDeletionSourceReport,
} from './legacy-deletion-readonly-audit.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
import { runSourceDeletionReadReview } from './legacy-deletion-source-review.mjs';
import { DatabaseSync } from 'node:sqlite';
test('derives every text fragment from unchanged legacy splitting without returning private content', () => {
  const row = {
    ownerId: randomUUID(),
    table: 'chat_history',
    id: '1',
    created_at: '2026-10-20T00:00:00Z',
    deleted_at: '2026-11-01T00:00:00Z',
    message_type: 'text',
    content: 'PRIVATE_SYNTHETIC_CANARY'.repeat(400),
  };
  const result = deletionFragmentReview([row], [], '2026-11-09T00:00:00Z');
  assert.equal(result.fragments.length, 3);
  assert.equal(result.fragments[2].messageId, legacyId('message', 'chat_history', '1', 2));
  assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC_CANARY'), false);
  assert.equal(result.summary.textSources, 1);
  assert.doesNotThrow(() => assertDeletionSourceReport(result));
  assert.throws(
    () =>
      assertDeletionSourceReport({
        summary: result.summary,
        fragments: [{ ...result.fragments[0], ownerId: '00000000-0000-0000-000000000000' }],
      }),
    /SOURCE_REVIEW_INVALID/,
  );
});
test('actual SQLite source queries exclude protected owners and group senders before returning private payloads', () => {
  const db = new DatabaseSync(':memory:');
  const owner = randomUUID(),
    excluded = randomUUID();
  try {
    db.exec(`CREATE TABLE app_users(id text);CREATE TABLE chat_groups(id text,user_id text);
CREATE TABLE chat_history(id integer,user_id text,content text,message_type text,created_at text,deleted_at text);
CREATE TABLE group_messages(id text,group_id text,user_id text,content text,message_type text,created_at text,deleted_at text);`);
    const at = '2026-10-20T00:00:00Z',
      deleted = '2026-11-01T00:00:00Z';
    for (const id of [owner, excluded]) db.prepare('INSERT INTO app_users VALUES(?)').run(id);
    db.prepare('INSERT INTO chat_groups VALUES(?,?)').run('allowed', owner);
    db.prepare('INSERT INTO chat_groups VALUES(?,?)').run('excluded', excluded);
    db.prepare('INSERT INTO chat_history VALUES(?,?,?,?,?,?)').run(
      1,
      owner,
      'x'.repeat(5000),
      'text',
      at,
      deleted,
    );
    db.prepare('INSERT INTO chat_history VALUES(?,?,?,?,?,?)').run(
      2,
      excluded,
      'PRIVATE_EXCLUDED',
      'text',
      at,
      deleted,
    );
    for (const [group, user] of [
      ['allowed', owner],
      ['allowed', excluded],
      ['excluded', excluded],
    ])
      db.prepare('INSERT INTO group_messages VALUES(?,?,?,?,?,?,?)').run(
        randomUUID(),
        group,
        user,
        'PRIVATE_SYNTHETIC',
        'text',
        at,
        deleted,
      );
    db.exec('PRAGMA query_only=ON');
    const query = (sql) => {
      assert.match(sql.trim(), /^SELECT /);
      return db
        .prepare(sql)
        .all()
        .map((row) => JSON.parse(Object.values(row)[0]));
    };
    const result = runSourceDeletionReadReview(
      [legacyMigrationOwnerDigest(excluded)],
      '2026-11-09T00:00:00Z',
      query,
    );
    assert.equal(result.summary.sourceRows, 2);
    assert.equal(result.fragments.length, 3);
    assert.ok(result.fragments.every((f) => f.ownerId === owner));
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
    assert.throws(() => db.exec('DELETE FROM chat_history'), /readonly/i);
  } finally {
    db.close();
  }
});
test('owner exclusion precedes payload and text group IDs remain stable; media completeness is not assumed', () => {
  const owner = randomUUID(),
    base = {
      ownerId: owner,
      table: 'group_messages',
      id: randomUUID(),
      created_at: '2026-10-20T00:00:00Z',
      deleted_at: '2026-11-01T00:00:00Z',
      message_type: 'text',
      content: 'synthetic',
    };
  assert.equal(
    deletionFragmentReview([base], [legacyMigrationOwnerDigest(owner)], '2026-11-09T00:00:00Z')
      .fragments.length,
    0,
  );
  const group = deletionFragmentReview([base], [], '2026-11-09T00:00:00Z');
  assert.equal(group.fragments[0].messageId, legacyId('message', 'group_messages', base.id, 0));
  const media = deletionFragmentReview(
    [{ ...base, message_type: 'image' }],
    [],
    '2026-11-09T00:00:00Z',
  );
  assert.equal(media.fragments[0].fullSourceScope, false);
  assert.equal(media.summary.mediaSourcesNeedingOriginalSplitProof, 1);
});
