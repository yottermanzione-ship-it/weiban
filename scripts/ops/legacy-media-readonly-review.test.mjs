import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  resolveLegacyMediaReference,
  hashReviewedMedia,
  reviewMediaRows,
  readSourceMediaRows,
} from './legacy-media-readonly-review.mjs';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const owner = randomUUID();
async function fixture() {
  // Deliberately retained: the manager requested keeping temporary rehearsal material.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'weiban-media-read-review-synthetic-'));
  const directory = path.join(root, 'public', 'generated', 'chat-images');
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'synthetic.png');
  await fs.writeFile(filename, Buffer.alloc(700000, 3));
  return { root, filename, ref: '/generated/chat-images/synthetic.png' };
}
test('only registered media roots and extensions; no remote fetch, traversal or configuration reads', () => {
  const root = '/synthetic';
  for (const ref of [
    '/opt/weiban-server/.env',
    '/generated/../../.env',
    '/generated/%2e%2e/secret.png',
    'file:///private.wav',
    '/generated/secret.key',
    '/generated/a%00.png',
  ])
    assert.equal(resolveLegacyMediaReference(ref, root).category, 'path_rejected');
  assert.equal(
    resolveLegacyMediaReference('https://example.invalid/private.png', root).category,
    'external_not_fetched',
  );
  assert.equal(
    resolveLegacyMediaReference('/stickers/builtin/smile.svg', root).category,
    'candidate',
  );
  assert.equal(resolveLegacyMediaReference('/api/voice/4', root).category, 'path_rejected');
});
test('hashes exact bytes, clears working buffers and only emits category/count summary', async () => {
  const f = await fixture();
  const candidate = resolveLegacyMediaReference(f.ref, f.root);
  const result = await hashReviewedMedia(candidate);
  assert.equal(result.category, 'ready');
  assert.equal(result.digest, sha(Buffer.alloc(700000, 3)));
  const summary = await reviewMediaRows(
    [
      { ownerId: owner, type: 'chat', references: [f.ref] },
      { ownerId: owner, type: 'profile', references: [f.ref] },
    ],
    { root: f.root },
  );
  assert.equal(summary.classifications.ready, 2);
  assert.equal(summary.uniqueFilesChecked, 1);
  assert.equal(summary.readyBytes, 700000);
  const output = JSON.stringify(summary);
  assert.ok(
    !output.includes(f.filename) &&
      !output.includes(f.ref) &&
      !output.includes(owner) &&
      !output.includes(result.digest),
  );
});
test('missing, empty, oversized, hardlinked and concurrently changed files are classified without original errors', async () => {
  const f = await fixture();
  const candidate = resolveLegacyMediaReference(f.ref, f.root);
  assert.equal((await hashReviewedMedia(candidate, { maxFileBytes: 10 })).category, 'too_large');
  assert.equal(
    (await hashReviewedMedia(candidate, { budget: { bytes: 0, limit: 10 } })).category,
    'budget_exceeded',
  );
  let changed = false;
  assert.equal(
    (
      await hashReviewedMedia(candidate, {
        onRead: async () => {
          if (!changed) {
            changed = true;
            await fs.appendFile(f.filename, 'change');
          }
        },
      })
    ).category,
    'changed',
  );
  await fs.writeFile(f.filename, '');
  assert.equal((await hashReviewedMedia(candidate)).category, 'empty');
  await fs.writeFile(f.filename, 'synthetic');
  await fs.link(f.filename, path.join(path.dirname(f.filename), 'other.png'));
  assert.equal((await hashReviewedMedia(candidate)).category, 'path_rejected');
  assert.equal(
    (
      await hashReviewedMedia(
        resolveLegacyMediaReference('/generated/chat-images/missing.png', f.root),
      )
    ).category,
    'missing',
  );
});
test('protected identities and retired source rows are excluded before file access', async () => {
  const f = await fixture();
  let reads = 0;
  const summary = await reviewMediaRows(
    [
      { ownerId: owner, type: 'chat', references: [f.ref] },
      { ownerId: randomUUID(), type: 'chat', references: [f.ref], retired: true },
    ],
    {
      root: f.root,
      preservedDigests: [sha('user:' + owner)],
      readHook: () => {
        reads++;
      },
    },
  );
  assert.equal(reads, 0);
  assert.equal(summary.preservedRows, 1);
  assert.equal(summary.classifications.retired, 1);
  assert.equal(summary.uniqueFilesChecked, 0);
});
test('actual SQLite query reads only scoped media pointers and authoritative non-deleted preference values', () => {
  const db = new DatabaseSync(':memory:');
  const skip = randomUUID(),
    included = randomUUID();
  try {
    db.exec(`CREATE TABLE app_users(id TEXT,avatar_url TEXT);CREATE TABLE chat_history(user_id TEXT,message_type TEXT,media_path TEXT,audio_url TEXT,deleted_at TEXT,media_status TEXT,content TEXT);
    CREATE TABLE chat_groups(id TEXT,user_id TEXT,avatar TEXT);CREATE TABLE group_messages(group_id TEXT,user_id TEXT,message_type TEXT,media_path TEXT,audio_url TEXT,deleted_at TEXT,media_status TEXT,content TEXT);
    CREATE TABLE user_stickers(user_id TEXT,image_url TEXT);CREATE TABLE moments(author_type TEXT,author_id TEXT,image_url TEXT);CREATE TABLE user_client_prefs(user_id TEXT,prefs_json TEXT);`);
    for (const id of [included, skip]) {
      db.prepare('INSERT INTO app_users VALUES(?,?)').run(id, '/generated/profile/' + id + '.png');
      db.prepare('INSERT INTO chat_history VALUES(?,?,?,?,?,?,?)').run(
        id,
        'voice',
        '/private/' + id + '.wav',
        '',
        null,
        'available',
        'BODY-MUST-NOT-LEAVE',
      );
    }
    db.prepare('INSERT INTO chat_groups VALUES(?,?,?)').run('group', included, '');
    db.prepare('INSERT INTO group_messages VALUES(?,?,?,?,?,?,?,?)').run(
      'group',
      skip,
      'voice',
      '/private/skip.wav',
      '',
      null,
      'available',
      'BODY-MUST-NOT-LEAVE',
    );
    db.prepare('INSERT INTO user_client_prefs VALUES(?,?)').run(
      included,
      JSON.stringify({
        _sync: {
          v: 1,
          entries: {
            chatBackgrounds: {
              a: { value: '/generated/live.png' },
              b: { value: '/generated/deleted.png', deleted: true },
            },
            friendAvatars: { a: { value: '/generated/avatar.png' } },
            momentsCover: { value: { value: '/generated/cover.png' } },
          },
        },
        chatBackgrounds: { wrong: '/generated/projection.png' },
        remarks: { private: 'PRIVATE-NOTE' },
      }),
    );
    db.exec(
      "ALTER TABLE chat_history ADD COLUMN id TEXT DEFAULT 'synthetic-id'; ALTER TABLE chat_history ADD COLUMN role TEXT DEFAULT 'user'; ALTER TABLE chat_history ADD COLUMN created_at TEXT DEFAULT '2026-11-08T00:00:00Z'; ALTER TABLE group_messages ADD COLUMN id TEXT DEFAULT 'synthetic-group'; ALTER TABLE group_messages ADD COLUMN sender_type TEXT DEFAULT 'character'; ALTER TABLE group_messages ADD COLUMN created_at TEXT DEFAULT '2026-11-08T00:00:00Z';",
    );
    const result = readSourceMediaRows([sha('user:' + skip)], (sql) =>
      db
        .prepare(sql)
        .all()
        .map((r) => JSON.parse(Object.values(r)[0])),
    );
    assert.equal(result.preservedAccounts, 1);
    assert.equal(result.rows.length, 5);
    assert.equal(result.rows.filter((r) => r.type === 'preferences').length, 3);
    const output = JSON.stringify(result);
    assert.ok(
      !output.includes(skip) &&
        !output.includes('BODY-MUST-NOT-LEAVE') &&
        !output.includes('PRIVATE-NOTE') &&
        !output.includes('projection.png') &&
        !output.includes('deleted.png'),
    );
    assert.equal(db.prepare('SELECT count(*) AS n FROM app_users').get().n, 2);
  } finally {
    db.close();
  }
});
