import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { legacyId } from './legacy-content-rules.mjs';
import {
  buildLegacyDeltaMediaPlan,
  transferLegacyDeltaMedia,
  importLegacyDeltaMedia,
  createLegacyDeltaMediaPort,
} from './legacy-delta-media.mjs';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { MediaService } from '../../apps/server/src/modules/media/application/media.ts';
import { objects as mediaTable } from '../../apps/server/src/modules/media/infra/db/schema.ts';

const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const sharp = serverRequire('sharp');
const { PgDialect } = serverRequire('drizzle-orm/pg-core');
const ALICE = legacyId('media-rehearsal-user', 'alice');
const BOB = legacyId('media-rehearsal-user', 'bob');
const ADMIN = legacyId('media-rehearsal-user', 'admin');
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempRoot, 'weiban-delta-media-synthetic-'));
  const sourceRoot = path.join(root, 'source');
  const stagingRoot = path.join(root, 'staging');
  await fs.mkdir(sourceRoot);
  await fs.mkdir(stagingRoot);
  t.after(async () => {
    const resolved = path.resolve(root);
    const relative = path.relative(tempRoot, resolved);
    assert.ok(relative.startsWith('weiban-delta-media-synthetic-') && !relative.includes(path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { root, sourceRoot, stagingRoot };
}
function mediaObject(archive, bytes, ownerUserId = ALICE, purpose = 'chat_voice') {
  const asset = {
    kind: 'file',
    source: `synthetic:${archive}`,
    path: `/synthetic/${archive}`,
    archive,
    bytes,
  };
  const id = legacyId('media', ownerUserId, purpose, asset.path);
  return {
    id,
    ownerUserId,
    purpose,
    asset,
    durationMs: 1000,
    stickerId: purpose === 'user_sticker' ? legacyId('user-sticker', ownerUserId, id) : null,
  };
}
async function writeSource(f, name, bytes) {
  await fs.mkdir(path.dirname(path.join(f.sourceRoot, name)), { recursive: true });
  await fs.writeFile(path.join(f.sourceRoot, name), bytes);
  return mediaObject(name, bytes.length);
}
function wav() {
  const bytes = Buffer.alloc(44 + 1600);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes;
}
const normalize = async (object, bytes) => ({
  bytes: Buffer.from(bytes),
  mimeType: object.purpose.includes('voice') ? 'audio/wav' : 'image/png',
  durationMs: object.durationMs ?? undefined,
});
async function prepared(t, objectFactory) {
  const f = await fixture(t);
  const object = await writeSource(f, 'media/synthetic.wav', wav());
  const list = objectFactory ? objectFactory(object) : [object];
  const plan = await buildLegacyDeltaMediaPlan({ ...f, objects: list, chunkBytes: 128 });
  assert.equal((await transferLegacyDeltaMedia({ ...f, plan })).summary.ok, true);
  return { ...f, object, plan };
}

/**
 * Only persistence/account-status are substituted. The production import method, decoder,
 * pending/ready store, cleanup, access check, readBytes and EnvelopeCrypto run unchanged.
 * No real database, network, application configuration, key file or background worker.
 */
function runtime(t) {
  const rows = new Map(),
    keys = new Map(),
    stored = new Map(),
    stickers = new Map();
  const status = new Map([
    [ALICE, 'active'],
    [BOB, 'active'],
  ]);
  const counters = { puts: 0, imports: 0, audits: 0, binds: 0 };
  let failStorageOnce = false,
    failBindingOnce = false;
  const dialect = new PgDialect();
  function matching(condition) {
    const { params } = dialect.sqlToQuery(condition);
    assert.ok(params.length === 1 || params.length === 2);
    const row = rows.get(params[0]);
    return row && (params.length === 1 || row.state === params[1]) ? [row] : [];
  }
  function checkedTable(table) {
    assert.equal(table, mediaTable);
  }
  const database = {
    db: {
      select: () => ({
        from: (table) => {
          checkedTable(table);
          return { where: async (condition) => matching(condition).map((row) => ({ ...row })) };
        },
      }),
      insert: (table) => {
        checkedTable(table);
        return {
          values: (value) => ({
            returning: async () => {
              if (rows.has(value.id)) throw new Error('SYNTHETIC_DUPLICATE_MEDIA');
              const row = { ...value };
              rows.set(row.id, row);
              return [{ ...row }];
            },
          }),
        };
      },
      update: (table) => {
        checkedTable(table);
        return {
          set: (changes) => ({
            where: (condition) => ({
              returning: async () =>
                matching(condition).map((row) => {
                  Object.assign(row, changes);
                  return { ...row };
                }),
            }),
          }),
        };
      },
      delete: (table) => {
        checkedTable(table);
        return {
          where: async (condition) => {
            for (const row of matching(condition)) rows.delete(row.id);
          },
        };
      },
    },
    query: async (sql, params) => {
      if (sql.startsWith('SELECT wrapped_dek, kek_version')) {
        const row = keys.get(params[0]);
        return {
          rows: row ? [{ ...row, wrapped_dek: Buffer.from(row.wrapped_dek) }] : [],
          rowCount: row ? 1 : 0,
        };
      }
      if (sql.startsWith('INSERT INTO platform.user_data_keys')) {
        if (keys.has(params[0])) return { rows: [], rowCount: 0 };
        keys.set(params[0], { wrapped_dek: Buffer.from(params[1]), kek_version: params[2] });
        return { rows: [{ owner: params[0] }], rowCount: 1 };
      }
      if (sql.startsWith('DELETE FROM platform.user_data_keys')) {
        keys.get(params[0])?.wrapped_dek.fill(0);
        keys.delete(params[0]);
        return { rows: [], rowCount: 1 };
      }
      throw new Error('SYNTHETIC_UNEXPECTED_SQL');
    },
    transaction: async (fn) => {
      const beforeRows = new Map([...rows].map(([id, row]) => [id, { ...row }]));
      const beforeKeys = new Map(
        [...keys].map(([owner, row]) => [
          owner,
          { ...row, wrapped_dek: Buffer.from(row.wrapped_dek) },
        ]),
      );
      try {
        return await fn(database);
      } catch (error) {
        rows.clear();
        for (const [id, row] of beforeRows) rows.set(id, row);
        for (const row of keys.values()) row.wrapped_dek.fill(0);
        keys.clear();
        for (const [owner, row] of beforeKeys) keys.set(owner, row);
        throw error;
      }
    },
  };
  const key = randomBytes(32);
  const clock = { now: () => new Date('2026-11-09T00:00:00Z'), nowMs: () => 1794182400000 };
  const crypto = new EnvelopeCrypto(database, clock, {
    currentVersion: 1,
    keys: new Map([[1, key]]),
  });
  const storage = {
    put: async (name, bytes) => {
      counters.puts++;
      if (failStorageOnce) {
        failStorageOnce = false;
        throw new Error('SYNTHETIC_STORAGE_FAILURE');
      }
      stored.set(name, Buffer.from(bytes));
    },
    get: async (name) => {
      if (!stored.has(name)) throw new Error('SYNTHETIC_STORAGE_MISSING');
      return Buffer.from(stored.get(name));
    },
    delete: async (name) => {
      stored.get(name)?.fill(0);
      stored.delete(name);
    },
  };
  const media = new MediaService(
    database,
    clock,
    crypto,
    storage,
    {},
    {
      record: async () => {
        counters.audits++;
      },
    },
    {},
    {},
    {},
    { getAccountStatus: async (id) => status.get(id) ?? 'deleted' },
  );
  const originalImport = media.importLegacyObject.bind(media);
  media.importLegacyObject = async (input) => {
    counters.imports++;
    return originalImport(input);
  };
  const port = createLegacyDeltaMediaPort({
    media,
    adminId: ADMIN,
    lookupObject: async (id) => (rows.get(id) ? { ...rows.get(id) } : null),
    bindSticker: async (object) => {
      counters.binds++;
      if (failBindingOnce) {
        failBindingOnce = false;
        throw new Error('SYNTHETIC_BINDING_FAILURE');
      }
      const existing = stickers.get(object.stickerId);
      if (existing && (existing.ownerUserId !== object.ownerUserId || existing.id !== object.id))
        throw new Error('SYNTHETIC_STICKER_CONFLICT');
      stickers.set(object.stickerId, { id: object.id, ownerUserId: object.ownerUserId });
    },
  });
  t.after(() => {
    key.fill(0);
    for (const row of keys.values()) row.wrapped_dek.fill(0);
    for (const sealed of stored.values()) sealed.fill(0);
    keys.clear();
    stored.clear();
    rows.clear();
    stickers.clear();
  });
  return {
    media,
    port,
    crypto,
    rows,
    stored,
    status,
    counters,
    stickers,
    failStorage: () => {
      failStorageOnce = true;
    },
    failBinding: () => {
      failBindingOnce = true;
    },
  };
}

test('manifest preserves legacy per-user identities and deduplicates transport only', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(501, 31);
  const alice = await writeSource(f, 'media/canary-source.bin', bytes);
  const bob = mediaObject(alice.asset.archive, bytes.length, BOB);
  const sameBytes = await writeSource(f, 'media/second-source.bin', bytes);
  const plan = await buildLegacyDeltaMediaPlan({
    ...f,
    objects: [alice, alice, bob, sameBytes],
    chunkBytes: 128,
  });
  assert.notEqual(alice.id, bob.id);
  assert.equal(plan.objects.length, 3);
  assert.equal(plan.files.length, 2);
  assert.equal(plan.files[0].chunks.length, 4);
  assert.equal(plan.summary.uniqueTransferFiles, 1);
  assert.equal(plan.summary.stagingBytes, bytes.length);
  const result = await transferLegacyDeltaMedia({ ...f, plan });
  assert.equal(result.summary.transferred, 1);
  assert.equal(result.summary.reused, 1);
  assert.deepEqual(await fs.readdir(f.stagingRoot), [`${digest(bytes)}.bin`]);
  const report = JSON.stringify({ plan: plan.summary, transfer: result.summary });
  for (const sensitive of [
    ALICE,
    BOB,
    alice.id,
    alice.asset.path,
    alice.asset.archive,
    digest(bytes),
  ])
    assert.equal(report.includes(sensitive), false);
});

test('missing, empty, changed, external and absent references stay separate and block completeness', async (t) => {
  const f = await fixture(t);
  const empty = await writeSource(f, 'media/empty.bin', Buffer.alloc(0));
  const changed = await writeSource(f, 'media/changed.bin', Buffer.from('xyz'));
  changed.asset.bytes++;
  const external = mediaObject('remote', 1);
  external.asset.kind = 'url';
  const plan = await buildLegacyDeltaMediaPlan({
    ...f,
    objects: [empty, changed, mediaObject('media/missing.bin', 100), external],
    unresolvedReferences: [{ classification: 'no_reference', count: 4 }],
  });
  assert.deepEqual(plan.summary.objectClassifications, {
    source_empty: 1,
    source_changed: 1,
    missing: 1,
    unsupported_external: 1,
  });
  assert.equal(plan.summary.ok, false);
  plan.summary.ok = true;
  assert.equal((await transferLegacyDeltaMedia({ ...f, plan })).summary.ok, false);
});

test('unsafe archive paths, directory junctions and hard links never read outside source root', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.bin'), Buffer.from('synthetic-only'));
  await fs.symlink(
    outside,
    path.join(f.sourceRoot, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await fs.link(path.join(outside, 'secret.bin'), path.join(f.sourceRoot, 'hard.bin'));
  const names = [
    '../outside/secret.bin',
    '/outside/secret.bin',
    'C:/outside/secret.bin',
    'nested\\secret.bin',
    'nested/../secret.bin',
    'secret.bin:stream',
    'NUL.txt',
    'trailing.',
    'linked/secret.bin',
    'hard.bin',
  ];
  const plan = await buildLegacyDeltaMediaPlan({
    ...f,
    objects: names.map((name) => mediaObject(name, 14)),
  });
  assert.deepEqual(plan.summary.objectClassifications, { path_rejected: names.length });
  assert.equal((await fs.readFile(path.join(outside, 'secret.bin'))).toString(), 'synthetic-only');
  await assert.rejects(
    buildLegacyDeltaMediaPlan({ sourceRoot: path.join(f.sourceRoot, 'linked'), objects: [] }),
    /path_rejected/,
  );
});

test('conflicting source and identity descriptors cannot become ready', async (t) => {
  const f = await fixture(t);
  const original = await writeSource(f, 'one.bin', Buffer.alloc(24, 3));
  const otherOwner = mediaObject('one.bin', 25, BOB);
  const malformedId = { ...original, id: BOB };
  let plan = await buildLegacyDeltaMediaPlan({
    ...f,
    objects: [original, otherOwner, malformedId],
  });
  assert.deepEqual(plan.summary.objectClassifications, {
    source_conflict: 2,
    identity_conflict: 1,
  });
  plan = await buildLegacyDeltaMediaPlan({
    ...f,
    objects: [original, { ...original, durationMs: 5000 }],
  });
  assert.deepEqual(plan.summary.objectClassifications, { identity_conflict: 2 });
});

test('interrupted transfer rechecks and repairs partial chunks despite forged checkpoint completion', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(400, 21);
  bytes.fill(42, 256);
  const object = await writeSource(f, 'media/partial.bin', bytes);
  const plan = await buildLegacyDeltaMediaPlan({ ...f, objects: [object], chunkBytes: 128 });
  let checkpoint;
  await assert.rejects(
    transferLegacyDeltaMedia({
      ...f,
      plan,
      onCheckpoint: async (value) => {
        checkpoint = value;
        if (value.verifiedChunks === 2) throw new Error('synthetic interruption with private text');
      },
    }),
    /MEDIA_CHECKPOINT_WRITE_FAILED/,
  );
  const partial = path.join(f.stagingRoot, `${plan.files[0].sha256}.partial`);
  const partialBytes = await fs.readFile(partial);
  partialBytes[0] ^= 255;
  await fs.writeFile(partial, partialBytes);
  checkpoint.transferredFiles = [plan.files[0].sourceKey];
  const result = await transferLegacyDeltaMedia({ ...f, plan, checkpoint });
  assert.equal(result.summary.ok, true);
  assert.equal(result.summary.reusedBytes, 128);
  assert.equal(result.summary.transferredBytes, bytes.length - 128);
  assert.deepEqual(await fs.readFile(path.join(f.stagingRoot, `${digest(bytes)}.bin`)), bytes);
  assert.deepEqual(await fs.readFile(path.join(f.sourceRoot, object.asset.archive)), bytes);
});

test('completed corruption is reported and explicit repair retransfers only verified staging data', async (t) => {
  const f = await prepared(t);
  const destination = path.join(f.stagingRoot, `${f.plan.files[0].sha256}.bin`);
  await fs.writeFile(destination, Buffer.alloc(wav().length, 91));
  const refused = await transferLegacyDeltaMedia({ ...f });
  assert.deepEqual(refused.summary.classifications, { staged_corrupt: 1 });
  const repaired = await transferLegacyDeltaMedia({ ...f, repairCorruptStaging: true });
  assert.equal(repaired.summary.ok, true);
  assert.equal(repaired.summary.repairedStagingFiles, 1);
  assert.equal(digest(await fs.readFile(destination)), f.plan.files[0].sha256);
});

test('changed pinned source blocks both ready reuse and corruption repair without deleting staged evidence', async (t) => {
  const f = await prepared(t);
  const changed = wav();
  changed[changed.length - 1] = 7;
  await fs.writeFile(path.join(f.sourceRoot, f.object.asset.archive), changed);
  assert.deepEqual((await transferLegacyDeltaMedia({ ...f })).summary.classifications, {
    source_changed: 1,
  });
  const destination = path.join(f.stagingRoot, `${f.plan.files[0].sha256}.bin`);
  const corrupt = Buffer.alloc(3, 1);
  await fs.writeFile(destination, corrupt);
  const repaired = await transferLegacyDeltaMedia({ ...f, repairCorruptStaging: true });
  assert.deepEqual(repaired.summary.classifications, { source_changed: 1 });
  assert.deepEqual(await fs.readFile(destination), corrupt);
});

test('a crash after atomic publication recovers only its exact two-link staging pair', async (t) => {
  const f = await prepared(t);
  const digestName = f.plan.files[0].sha256;
  await fs.link(
    path.join(f.stagingRoot, `${digestName}.bin`),
    path.join(f.stagingRoot, `${digestName}.partial`),
  );
  assert.equal((await transferLegacyDeltaMedia({ ...f })).summary.ok, true);
  assert.deepEqual(await fs.readdir(f.stagingRoot), [`${digestName}.bin`]);
});

test('staging junctions, changed plans and unrelated checkpoint batches fail closed', async (t) => {
  const f = await prepared(t);
  const linked = path.join(f.root, 'stage-link');
  await fs.symlink(f.stagingRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(transferLegacyDeltaMedia({ ...f, stagingRoot: linked }), /path_rejected/);
  const nested = path.join(f.sourceRoot, 'nested-stage');
  await fs.mkdir(nested);
  await assert.rejects(transferLegacyDeltaMedia({ ...f, stagingRoot: nested }), /path_rejected/);
  await assert.rejects(
    transferLegacyDeltaMedia({ ...f, sourceRoot: path.join(f.root, 'missing-root') }),
    (error) => error.message === 'path_rejected',
  );
  const changed = structuredClone(f.plan);
  changed.files[0].chunks[0] = 'a'.repeat(64);
  await assert.rejects(transferLegacyDeltaMedia({ ...f, plan: changed }), /MEDIA_PLAN_INVALID/);
  await assert.rejects(
    transferLegacyDeltaMedia({ ...f, checkpoint: { version: 1, planFingerprint: '0'.repeat(64) } }),
    /MEDIA_CHECKPOINT_PLAN_MISMATCH/,
  );
});

test('unavailable and corrupted staging files never reach the real importer', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  const destination = path.join(f.stagingRoot, `${f.plan.files[0].sha256}.bin`);
  await fs.writeFile(destination, Buffer.from('damaged synthetic bytes'));
  let result = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  assert.deepEqual(result.summary.classifications, { staged_corrupt: 1 });
  await fs.unlink(destination);
  result = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  assert.deepEqual(result.summary.classifications, { staged_missing: 1 });
  assert.equal(app.counters.imports, 0);
  assert.equal(app.rows.size, 0);
});

test('real MediaService encrypts separate owner objects and reruns decode, ownership and hash checks', async (t) => {
  const f = await prepared(t, (alice) => [
    alice,
    mediaObject(alice.asset.archive, alice.asset.bytes, BOB),
  ]);
  const app = runtime(t);
  const first = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  assert.equal(first.summary.created, 2);
  assert.equal(first.ready.size, 2);
  assert.equal(app.rows.size, 2);
  assert.equal(app.stored.size, 2);
  const [alice, bob] = f.plan.objects;
  assert.notDeepEqual(app.stored.get(`${alice.id}.sealed`), app.stored.get(`${bob.id}.sealed`));
  assert.equal(await app.media.canUse(BOB, alice.id, ['chat_voice']), false);
  await assert.rejects(
    app.crypto.open(BOB, `media:${alice.id}`, app.stored.get(`${alice.id}.sealed`)),
  );
  await assert.rejects(
    app.crypto.open(ALICE, `media:${bob.id}`, app.stored.get(`${alice.id}.sealed`)),
  );
  const plaintext = await app.media.readBytes(alice.id);
  assert.deepEqual(plaintext.bytes, wav());
  plaintext.bytes.fill(0);
  const second = await importLegacyDeltaMedia({
    ...f,
    normalize,
    mediaPort: app.port,
    checkpoint: first.checkpoint,
  });
  assert.equal(second.summary.reused, 2);
  assert.equal(second.summary.created, 0);
  assert.equal(app.counters.imports, 2);
  assert.equal(app.counters.audits, 2);
});

test('real image decode, WebP storage and per-user sticker binding agree with expected stored hash', async (t) => {
  const f = await fixture(t);
  const image = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#2580d5' },
  })
    .png()
    .toBuffer();
  await writeSource(f, 'media/synthetic.png', image);
  const object = mediaObject('media/synthetic.png', image.length, ALICE, 'user_sticker');
  const plan = await buildLegacyDeltaMediaPlan({ ...f, objects: [object] });
  await transferLegacyDeltaMedia({ ...f, plan });
  const app = runtime(t);
  app.failBinding();
  const first = await importLegacyDeltaMedia({ ...f, plan, normalize, mediaPort: app.port });
  assert.deepEqual(first.summary.classifications, { binding_failed: 1 });
  assert.equal(first.ready.size, 0);
  const second = await importLegacyDeltaMedia({ ...f, plan, normalize, mediaPort: app.port });
  assert.equal(second.summary.ok, true);
  assert.equal(second.summary.reused, 1);
  assert.equal(app.counters.imports, 1);
  assert.equal(app.stickers.size, 1);
  assert.equal(app.rows.get(object.id).mimeType, 'image/webp');
  assert.notEqual(app.rows.get(object.id).contentHash, digest(image));
  const actual = await app.media.readBytes(object.id);
  assert.equal(digest(actual.bytes), second.ready.get(object.id).contentHash);
  actual.bytes.fill(0);
});

test('actual pending store cleans up a failed write and the same object can safely retry', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  app.failStorage();
  const failed = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  assert.deepEqual(failed.summary.classifications, { import_failed: 1 });
  assert.equal(app.rows.size, 0);
  assert.equal(app.stored.size, 0);
  assert.equal(failed.ready.size, 0);
  const retry = await importLegacyDeltaMedia({
    ...f,
    normalize,
    mediaPort: app.port,
    checkpoint: failed.checkpoint,
  });
  assert.equal(retry.summary.created, 1);
  assert.equal(app.rows.size, 1);
});

test('import checkpoint failure resumes committed work and ciphertext corruption still blocks ready', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  let checkpoint;
  await assert.rejects(
    importLegacyDeltaMedia({
      ...f,
      normalize,
      mediaPort: app.port,
      onCheckpoint: async (value) => {
        checkpoint = value;
        throw new Error('synthetic stop');
      },
    }),
    /MEDIA_CHECKPOINT_WRITE_FAILED/,
  );
  assert.equal(app.rows.size, 1);
  const resumed = await importLegacyDeltaMedia({
    ...f,
    normalize,
    mediaPort: app.port,
    checkpoint,
  });
  assert.equal(resumed.summary.reused, 1);
  assert.equal(app.counters.imports, 1);
  app.stored.get(`${f.object.id}.sealed`)[20] ^= 255;
  const corrupt = await importLegacyDeltaMedia({
    ...f,
    normalize,
    mediaPort: app.port,
    checkpoint,
  });
  assert.deepEqual(corrupt.summary.classifications, { decrypt_failed: 1 });
  assert.equal(corrupt.ready.size, 0);
  assert.equal(app.counters.imports, 1);
});

test('wrong owner, purpose, state or expected decoded hash preserves existing data and cannot be reused', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  const original = { ...app.rows.get(f.object.id) };
  for (const [changes, classification] of [
    [{ ownerId: BOB }, 'owner_conflict'],
    [{ purpose: 'user_avatar' }, 'owner_conflict'],
    [{ state: 'pending' }, 'target_not_ready'],
    [{ contentHash: '0'.repeat(64) }, 'target_content_mismatch'],
    [{ sizeBytes: 5 }, 'target_content_mismatch'],
  ]) {
    app.rows.set(f.object.id, { ...original, ...changes });
    const result = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
    assert.deepEqual(result.summary.classifications, { [classification]: 1 });
    assert.equal(result.ready.size, 0);
    assert.deepEqual(app.rows.get(f.object.id), { ...original, ...changes });
  }
  assert.equal(app.counters.imports, 1);
});

test('deleted accounts cannot recreate keys and normalization cannot override owner or admin identity', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  app.status.set(ALICE, 'deleted');
  const failed = await importLegacyDeltaMedia({ ...f, normalize, mediaPort: app.port });
  assert.equal(failed.summary.failed, 1);
  assert.equal(app.rows.size, 0);
  app.status.set(ALICE, 'active');
  const actual = await importLegacyDeltaMedia({
    ...f,
    mediaPort: app.port,
    normalize: async (object, bytes) => ({
      ...(await normalize(object, bytes)),
      id: BOB,
      ownerUserId: BOB,
      purpose: 'user_avatar',
      adminId: BOB,
    }),
  });
  assert.equal(actual.summary.ok, true);
  assert.equal(app.rows.get(f.object.id).ownerId, ALICE);
  assert.equal(app.rows.has(BOB), false);
});

test('source and normalized plaintext buffers are cleared even when an importer fails', async (t) => {
  const f = await prepared(t);
  const app = runtime(t);
  app.failStorage();
  let source, output;
  await importLegacyDeltaMedia({
    ...f,
    mediaPort: app.port,
    normalize: async (object, bytes) => {
      source = bytes;
      output = await normalize(object, bytes);
      return output;
    },
  });
  assert.ok(source.every((byte) => byte === 0));
  assert.ok(output.bytes.every((byte) => byte === 0));
});
