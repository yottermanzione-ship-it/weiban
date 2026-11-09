/** Chat attachments only. No connections/config/transport at import time; no plaintext files. */
import { createHash } from 'node:crypto';
import { legacyId } from './legacy-content-rules.mjs';
import { assertMigrationOwnersAllowed, migrationOwnersOf } from './fast-cutover-owners.mjs';

const PURPOSES = new Set(['chat_image', 'chat_voice', 'generated_voice', 'user_sticker']);
const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const need = (value, code) => {
  if (!value) throw new Error(code);
};
const errorCode = (error) =>
  /^FAST_MEDIA_[A-Z_]+$/.test(String(error?.message)) ? error.message : 'FAST_MEDIA_IMPORT_FAILED';

async function lookup(database, id) {
  return (
    (
      await database.query(
        `SELECT id,owner_id AS "ownerId",purpose,state,mime_type AS "mimeType",
       size_bytes AS "sizeBytes",content_hash AS "contentHash",duration_ms AS "durationMs"
     FROM media.objects WHERE id=$1`,
        [id],
      )
    ).rows[0] ?? null
  );
}
function checkTarget(object, target, expectedHash) {
  need(target && target.state === 'ready', 'FAST_MEDIA_TARGET_NOT_READY');
  need(
    target.id === object.id &&
      target.ownerId === object.ownerUserId &&
      target.purpose === object.purpose,
    'FAST_MEDIA_TARGET_OWNER_CONFLICT',
  );
  need(SHA.test(target.contentHash), 'FAST_MEDIA_TARGET_HASH_MISSING');
  if (expectedHash) need(target.contentHash === expectedHash, 'FAST_MEDIA_TARGET_HASH_MISMATCH');
}
async function verifyReady({ object, target, media, database, expectedHash }) {
  checkTarget(object, target, expectedHash);
  need(
    await media.canUse(object.ownerUserId, object.id, [object.purpose]),
    'FAST_MEDIA_ACCESS_REJECTED',
  );
  let readback;
  try {
    readback = await media.readBytes(object.id);
    need(
      readback?.bytes instanceof Uint8Array &&
        sha(readback.bytes) === target.contentHash &&
        readback.bytes.length === Number(target.sizeBytes) &&
        readback.mimeType === target.mimeType,
      'FAST_MEDIA_READBACK_MISMATCH',
    );
  } finally {
    readback?.bytes?.fill(0);
  }
  if (object.purpose === 'user_sticker') {
    const saved = (
      await database.query('SELECT user_id,media_id FROM media.user_stickers WHERE id=$1', [
        object.stickerId,
      ])
    ).rows[0];
    // Historical bubbles use mediaId directly. Do not restore a later-deleted personal saved sticker.
    if (saved)
      need(
        saved.user_id === object.ownerUserId && saved.media_id === object.id,
        'FAST_MEDIA_STICKER_OWNER_CONFLICT',
      );
  }
  return {
    id: object.id,
    ownerUserId: object.ownerUserId,
    purpose: object.purpose,
    stickerId: object.stickerId ?? null,
    contentHash: target.contentHash,
  };
}

/**
 * objects use the existing 10-24 deterministic IDs, not new identities.
 * readSource(object) => {bytes:Uint8Array,sha256:string} OR {status:'missing_file'}.
 * sha256 must come from the old host's same verified read. Other errors must throw.
 * normalize(object,bytes) must reuse the existing MediaService image/audio processing;
 * createFastCutoverMediaRuntime supplies it. Plan mode does not read source bytes or write.
 * Return ready Map is only populated after decrypt/hash verification in execute mode.
 */
export async function importFastCutoverMedia({
  objects,
  database,
  media,
  adminId,
  readSource,
  normalize,
  execute = false,
  options = {},
}) {
  need(Array.isArray(objects) && typeof database?.query === 'function', 'FAST_MEDIA_INPUT_INVALID');
  const unique = new Map();
  for (const object of objects) {
    need(
      UUID.test(object.id) && UUID.test(object.ownerUserId) && PURPOSES.has(object.purpose),
      'FAST_MEDIA_IDENTITY_INVALID',
    );
    need(
      object.asset &&
        ['file', 'url'].includes(object.asset.kind) &&
        typeof object.asset.path === 'string' &&
        object.asset.path.length > 0 &&
        object.id === legacyId('media', object.ownerUserId, object.purpose, object.asset.path),
      'FAST_MEDIA_STABLE_ID_MISMATCH',
    );
    if (object.purpose === 'user_sticker')
      need(
        object.stickerId === legacyId('user-sticker', object.ownerUserId, object.id),
        'FAST_MEDIA_STICKER_ID_MISMATCH',
      );
    assertMigrationOwnersAllowed(migrationOwnersOf(object, object.ownerUserId), options);
    unique.set(object.id, object);
  }
  const existing = new Map();
  // Check every destination owner before the first write, including misleading source descriptors.
  for (const object of unique.values()) {
    const target = await lookup(database, object.id);
    if (target) {
      assertMigrationOwnersAllowed([target.ownerId], options);
      checkTarget(object, target);
      existing.set(object.id, target);
    }
  }
  if (execute) {
    need(UUID.test(adminId) && media, 'FAST_MEDIA_RUNTIME_REQUIRED');
    need(
      (
        await database.query(
          "SELECT 1 FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
          [adminId],
        )
      ).rows.length,
      'FAST_MEDIA_ACTIVE_ADMIN_REQUIRED',
    );
  }
  const ready = new Map(),
    outcomes = [];
  const summary = { created: 0, reused: 0, planned: 0, missing: 0, failed: 0, verified: 0 };
  for (const object of unique.values()) {
    let source, file;
    try {
      if (!execute) {
        summary.planned++;
        outcomes.push({
          objectId: object.id,
          classification: existing.has(object.id) ? 'reuse_planned' : 'import_planned',
        });
        continue;
      }
      const target = existing.get(object.id);
      if (target) {
        ready.set(object.id, await verifyReady({ object, target, media, database }));
        summary.reused++;
        summary.verified++;
        outcomes.push({ objectId: object.id, classification: 'ready', created: false });
        continue;
      }
      need(
        typeof readSource === 'function' && typeof normalize === 'function',
        'FAST_MEDIA_SOURCE_RUNTIME_REQUIRED',
      );
      source = await readSource(object);
      if (source?.status === 'missing_file') {
        summary.missing++;
        outcomes.push({ objectId: object.id, classification: 'missing_file' });
        continue;
      }
      need(
        source?.bytes instanceof Uint8Array && source.bytes.length > 0 && SHA.test(source.sha256),
        'FAST_MEDIA_SOURCE_RESULT_INVALID',
      );
      need(source.bytes.length <= 64 * 1024 * 1024, 'FAST_MEDIA_SOURCE_TOO_LARGE');
      need(
        sha(source.bytes) === source.sha256 &&
          (object.asset.sha256 == null || object.asset.sha256 === source.sha256) &&
          (object.asset.bytes == null || Number(object.asset.bytes) === source.bytes.length),
        'FAST_MEDIA_SOURCE_CHANGED',
      );
      file = await normalize(object, source.bytes);
      need(
        file?.bytes instanceof Uint8Array &&
          file.bytes.length > 0 &&
          typeof file.mimeType === 'string',
        'FAST_MEDIA_NORMALIZATION_FAILED',
      );
      let expectedHash;
      if (['chat_voice', 'generated_voice'].includes(object.purpose))
        expectedHash = sha(file.bytes);
      else {
        const imageCopy = Buffer.from(file.bytes);
        try {
          expectedHash = (
            await media.inspectLibraryImage({ buffer: imageCopy, mimetype: file.mimeType })
          ).contentHash;
        } finally {
          imageCopy.fill(0);
        }
      }
      need(SHA.test(expectedHash), 'FAST_MEDIA_NORMALIZATION_FAILED');
      const result = await media.importLegacyObject({
        id: object.id,
        adminId,
        ownerUserId: object.ownerUserId,
        purpose: object.purpose,
        bytes: file.bytes,
        mimeType: file.mimeType,
        ...(file.durationMs == null ? {} : { durationMs: file.durationMs }),
      });
      need(
        result?.mediaId === object.id && typeof result.created === 'boolean',
        'FAST_MEDIA_IMPORT_RESULT_INVALID',
      );
      const after = await lookup(database, object.id);
      ready.set(object.id, {
        ...(await verifyReady({ object, target: after, media, database, expectedHash })),
        sourceSha256: source.sha256,
      });
      summary[result.created ? 'created' : 'reused']++;
      summary.verified++;
      outcomes.push({ objectId: object.id, classification: 'ready', created: result.created });
    } catch (error) {
      summary.failed++;
      outcomes.push({ objectId: object.id, classification: 'failed', code: errorCode(error) });
    } finally {
      source?.bytes?.fill(0);
      file?.bytes?.fill(0);
    }
  }
  return {
    mode: execute ? 'apply' : 'plan',
    ready,
    outcomes,
    summary: { ...summary, ok: execute && summary.failed === 0 && summary.planned === 0 },
  };
}
