/**
 * Offline delta-media preparation. This module never loads application config, opens a
 * database, downloads a URL, or logs a source path. Plans/checkpoints are protected
 * operator data; only the fixed-category `summary` objects may enter a public report.
 * Use exclusively owned local directories, with no concurrent filesystem writers.
 */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { legacyId } from './legacy-content-rules.mjs';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PURPOSES = new Set([
  'chat_image',
  'chat_voice',
  'generated_voice',
  'user_sticker',
  'moments_image',
  'user_avatar',
  'group_avatar',
]);
const CLASSIFICATIONS = new Set([
  'ready',
  'missing',
  'no_reference',
  'unsupported_external',
  'path_rejected',
  'source_changed',
  'source_empty',
  'source_too_large',
  'source_io',
  'identity_conflict',
  'source_conflict',
  'staged_missing',
  'staged_corrupt',
  'import_failed',
  'owner_conflict',
  'target_not_ready',
  'target_content_mismatch',
  'access_rejected',
  'decrypt_failed',
  'normalization_failed',
  'binding_failed',
]);

function fail(code) {
  const error = new Error(code);
  error.mediaDeltaCode = code;
  return error;
}
function classified(error, fallback = 'source_io') {
  return CLASSIFICATIONS.has(error?.mediaDeltaCode) ? error.mediaDeltaCode : fallback;
}
function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function planReady(plan) {
  return (
    plan.files.every((file) => file.classification === 'ready') &&
    plan.objects.every((object) => object.classification === 'ready') &&
    plan.unresolvedReferences.length === 0
  );
}
function checkedArchive(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\:]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw fail('path_rejected');
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part)))
    throw fail('path_rejected');
  if (parts.some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw fail('path_rejected');
  return parts;
}
async function checkedRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^\\\\/.test(value))
    throw fail('path_rejected');
  try {
    const root = path.resolve(value);
    const parsed = path.parse(root);
    let current = parsed.root;
    for (const part of root.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('path_rejected');
    }
    if (!samePath(await fs.realpath(root), root)) throw fail('path_rejected');
    return root;
  } catch {
    throw fail('path_rejected');
  }
}
async function checkedFile(root, archive, allowMissing = false) {
  const parts = checkedArchive(archive);
  let filename = root;
  for (let index = 0; index < parts.length; index++) {
    filename = path.join(filename, parts[index]);
    let stat;
    try {
      stat = await fs.lstat(filename);
    } catch (error) {
      if (error.code === 'ENOENT') {
        if (allowMissing && index === parts.length - 1) return { filename, stat: null };
        throw fail('missing');
      }
      throw error;
    }
    if (stat.isSymbolicLink()) throw fail('path_rejected');
    if (index < parts.length - 1) {
      if (!stat.isDirectory()) throw fail('path_rejected');
    } else {
      if (!stat.isFile() || stat.nlink !== 1) throw fail('path_rejected');
      const real = await fs.realpath(filename);
      const relative = path.relative(root, real);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw fail('path_rejected');
      return { filename, stat };
    }
  }
  throw fail('path_rejected');
}
function unchanged(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}
async function openChecked(root, archive, flags = constants.O_RDONLY) {
  const checked = await checkedFile(root, archive);
  const handle = await fs.open(checked.filename, flags | (constants.O_NOFOLLOW ?? 0));
  const stat = await handle.stat();
  if (!unchanged(checked.stat, stat)) {
    await handle.close();
    throw fail('source_changed');
  }
  return { handle, stat, filename: checked.filename };
}
async function readExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesRead) throw fail('source_changed');
    offset += bytesRead;
  }
}
async function writeExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    );
    if (!bytesWritten) throw fail('source_io');
    offset += bytesWritten;
  }
}
async function fingerprintFile(root, archive, expectedBytes, chunkBytes, maxSourceBytes) {
  const opened = await openChecked(root, archive);
  const hash = createHash('sha256');
  const chunks = [];
  let buffer;
  try {
    if (opened.stat.size === 0) throw fail('source_empty');
    if (opened.stat.size !== expectedBytes) throw fail('source_changed');
    if (opened.stat.size > maxSourceBytes) throw fail('source_too_large');
    for (let offset = 0; offset < expectedBytes; offset += chunkBytes) {
      buffer = Buffer.alloc(Math.min(chunkBytes, expectedBytes - offset));
      await readExactly(opened.handle, buffer, offset);
      hash.update(buffer);
      chunks.push(sha(buffer));
      buffer.fill(0);
    }
    const end = await checkedFile(root, archive);
    if (!unchanged(opened.stat, await opened.handle.stat()) || !unchanged(opened.stat, end.stat))
      throw fail('source_changed');
    return { sha256: hash.digest('hex'), chunks };
  } finally {
    buffer?.fill(0);
    await opened.handle.close();
  }
}
function objectIdentity(object) {
  return (
    object &&
    UUID.test(object.ownerUserId) &&
    PURPOSES.has(object.purpose) &&
    typeof object.asset?.path === 'string' &&
    object.asset.path.length > 0 &&
    object.id === legacyId('media', object.ownerUserId, object.purpose, object.asset.path) &&
    (object.purpose !== 'user_sticker' ||
      object.stickerId === legacyId('user-sticker', object.ownerUserId, object.id))
  );
}
function countBy(items) {
  const result = {};
  for (const item of items) result[item.classification] = (result[item.classification] ?? 0) + 1;
  return result;
}
function planFingerprint(plan) {
  const { fingerprint: _fingerprint, summary: _summary, ...protectedData } = plan;
  return sha(JSON.stringify(protectedData));
}
function checkPlan(plan) {
  if (
    plan?.version !== 1 ||
    !HASH.test(plan.fingerprint) ||
    plan.fingerprint !== planFingerprint(plan) ||
    !Array.isArray(plan.files) ||
    !Array.isArray(plan.objects) ||
    !Array.isArray(plan.unresolvedReferences) ||
    !Number.isSafeInteger(plan.chunkBytes) ||
    plan.chunkBytes < 1 ||
    plan.chunkBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(plan.maxSourceBytes) ||
    plan.maxSourceBytes < 1
  )
    throw fail('MEDIA_PLAN_INVALID');
  if (
    plan.unresolvedReferences.some(
      (reference) =>
        !['missing', 'no_reference', 'unsupported_external'].includes(reference.classification) ||
        !Number.isSafeInteger(reference.count) ||
        reference.count < 1,
    )
  )
    throw fail('MEDIA_PLAN_INVALID');
  const fileKeys = new Set();
  for (const file of plan.files) {
    if (
      !HASH.test(file.sourceKey) ||
      fileKeys.has(file.sourceKey) ||
      !CLASSIFICATIONS.has(file.classification)
    )
      throw fail('MEDIA_PLAN_INVALID');
    fileKeys.add(file.sourceKey);
    if (file.classification !== 'ready') continue;
    checkedArchive(file.archive);
    if (
      !HASH.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      file.bytes > plan.maxSourceBytes ||
      !Array.isArray(file.chunks) ||
      file.chunks.length !== Math.ceil(file.bytes / plan.chunkBytes) ||
      file.chunks.some((chunk) => !HASH.test(chunk))
    )
      throw fail('MEDIA_PLAN_INVALID');
  }
  const ids = new Set();
  for (const object of plan.objects) {
    if (!CLASSIFICATIONS.has(object.classification)) throw fail('MEDIA_PLAN_INVALID');
    if (object.classification !== 'ready') continue;
    if (!objectIdentity(object) || ids.has(object.id) || !fileKeys.has(object.sourceKey))
      throw fail('MEDIA_PLAN_INVALID');
    const file = plan.files.find((entry) => entry.sourceKey === object.sourceKey);
    if (
      file.classification !== 'ready' ||
      file.archive !== object.asset.archive ||
      file.bytes !== object.asset.bytes
    )
      throw fail('MEDIA_PLAN_INVALID');
    ids.add(object.id);
  }
}

/** Input objects are exactly the existing import-legacy-content media-plan objects. */
export async function buildLegacyDeltaMediaPlan({
  objects,
  sourceRoot,
  unresolvedReferences = [],
  chunkBytes = 1024 * 1024,
  maxSourceBytes = 128 * 1024 * 1024,
}) {
  if (
    !Array.isArray(objects) ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1 ||
    chunkBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(maxSourceBytes) ||
    maxSourceBytes < 1 ||
    !Array.isArray(unresolvedReferences) ||
    unresolvedReferences.some(
      (reference) =>
        !['missing', 'no_reference', 'unsupported_external'].includes(reference.classification) ||
        !Number.isSafeInteger(reference.count) ||
        reference.count < 1,
    )
  )
    throw fail('MEDIA_PLAN_INPUT_INVALID');
  const root = await checkedRoot(sourceRoot);
  const candidates = objects.map((object) => ({
    id: object?.id,
    ownerUserId: object?.ownerUserId,
    purpose: object?.purpose,
    stickerId: object?.stickerId ?? null,
    durationMs: object?.durationMs ?? null,
    asset: object?.asset ? structuredClone(object.asset) : null,
    classification: 'ready',
  }));
  const objectIds = new Map();
  const sources = new Map();
  for (const object of candidates) {
    if (!objectIdentity(object)) {
      object.classification = 'identity_conflict';
      continue;
    }
    const previous = objectIds.get(object.id);
    if (previous) {
      // Exact repeats are harmless references; contradictory descriptors fail closed.
      if (
        JSON.stringify(previous.asset) !== JSON.stringify(object.asset) ||
        previous.durationMs !== object.durationMs
      ) {
        previous.classification = 'identity_conflict';
        object.classification = 'identity_conflict';
      } else object.duplicate = true;
      continue;
    }
    objectIds.set(object.id, object);
    if (object.asset.kind !== 'file') {
      object.classification = object.asset.kind === 'url' ? 'unsupported_external' : 'no_reference';
      continue;
    }
    try {
      checkedArchive(object.asset.archive);
    } catch {
      object.classification = 'path_rejected';
      continue;
    }
    if (!Number.isSafeInteger(object.asset.bytes) || object.asset.bytes < 0) {
      object.classification = 'source_conflict';
      continue;
    }
    const sourceKey = sha(object.asset.archive);
    object.sourceKey = sourceKey;
    if (!sources.has(sourceKey))
      sources.set(sourceKey, {
        sourceKey,
        archive: object.asset.archive,
        bytes: object.asset.bytes,
        classification: 'ready',
      });
    const source = sources.get(sourceKey);
    if (source.bytes !== object.asset.bytes) source.classification = 'source_conflict';
  }
  for (const file of sources.values()) {
    if (file.classification !== 'ready') continue;
    try {
      Object.assign(
        file,
        await fingerprintFile(root, file.archive, file.bytes, chunkBytes, maxSourceBytes),
      );
    } catch (error) {
      file.classification = classified(error);
    }
  }
  const uniqueObjects = candidates.filter((object) => !object.duplicate);
  for (const object of uniqueObjects) {
    if (object.classification === 'ready')
      object.classification = sources.get(object.sourceKey).classification;
  }
  const plan = {
    version: 1,
    chunkBytes,
    maxSourceBytes,
    files: [...sources.values()],
    objects: uniqueObjects,
    unresolvedReferences: unresolvedReferences.map(({ classification, count }) => ({
      classification,
      count,
    })),
  };
  const uniqueTransfer = new Map(
    plan.files
      .filter((file) => file.classification === 'ready')
      .map((file) => [file.sha256, file.bytes]),
  );
  plan.summary = {
    ok:
      plan.files.every((file) => file.classification === 'ready') &&
      uniqueObjects.every((object) => object.classification === 'ready') &&
      unresolvedReferences.length === 0,
    inputObjects: objects.length,
    objects: uniqueObjects.length,
    files: plan.files.length,
    fileClassifications: countBy(plan.files),
    objectClassifications: countBy(uniqueObjects),
    unresolvedReferences: unresolvedReferences.reduce((sum, reference) => sum + reference.count, 0),
    unresolvedClassifications: Object.fromEntries(
      ['missing', 'no_reference', 'unsupported_external'].map((classification) => [
        classification,
        unresolvedReferences
          .filter((ref) => ref.classification === classification)
          .reduce((sum, ref) => sum + ref.count, 0),
      ]),
    ),
    uniqueTransferFiles: uniqueTransfer.size,
    sourceBytes: plan.files
      .filter((file) => file.classification === 'ready')
      .reduce((sum, file) => sum + file.bytes, 0),
    stagingBytes: [...uniqueTransfer.values()].reduce((sum, bytes) => sum + bytes, 0),
    // An estimate assuming unchanged bodies: decoder expansion, thumbnails and metadata are extra.
    untransformedEncryptedBytesEstimate: uniqueObjects
      .filter((object) => object.classification === 'ready')
      .reduce((sum, object) => sum + object.asset.bytes + 29, 0),
    maxWorkingSourceBytes: Math.max(
      0,
      ...plan.files.filter((file) => file.classification === 'ready').map((file) => file.bytes),
    ),
  };
  plan.fingerprint = planFingerprint(plan);
  return plan;
}

function checkpointFor(plan, checkpoint) {
  if (checkpoint && (checkpoint.version !== 1 || checkpoint.planFingerprint !== plan.fingerprint))
    throw fail('MEDIA_CHECKPOINT_PLAN_MISMATCH');
  // Never trust stored completion flags. Disk bytes, ownership and decryption are rechecked.
  return {
    version: 1,
    planFingerprint: plan.fingerprint,
    transferredFiles: [],
    importedObjects: [],
  };
}
async function saveCheckpoint(checkpoint, onCheckpoint) {
  if (!onCheckpoint) return;
  try {
    await onCheckpoint(structuredClone(checkpoint));
  } catch {
    throw fail('MEDIA_CHECKPOINT_WRITE_FAILED');
  }
}
function sameFingerprint(a, b) {
  return a.sha256 === b.sha256 && JSON.stringify(a.chunks) === JSON.stringify(b.chunks);
}
async function transferOne({
  file,
  plan,
  sourceRoot,
  stagingRoot,
  checkpoint,
  onCheckpoint,
  stats,
  repairCorruptStaging,
}) {
  const destination = `${file.sha256}.bin`;
  const pending = `${file.sha256}.partial`;
  // A process may stop between the atomic hard-link publication and temporary-name removal.
  // Only this exact two-link pair can be reclaimed; an external hard link is never accepted.
  const pair = await Promise.all(
    [destination, pending].map(async (name) => {
      try {
        return await fs.lstat(path.join(stagingRoot, name));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }),
  );
  if (
    pair.every((stat) => stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 2) &&
    pair[0].dev === pair[1].dev &&
    pair[0].ino === pair[1].ino
  )
    await fs.unlink(path.join(stagingRoot, pending));
  const existing = await checkedFile(stagingRoot, destination, true);
  let repairing = false;
  if (existing.stat) {
    try {
      const observed = await fingerprintFile(
        stagingRoot,
        destination,
        file.bytes,
        plan.chunkBytes,
        plan.maxSourceBytes,
      );
      if (!sameFingerprint(observed, file)) throw fail('staged_corrupt');
    } catch (error) {
      if (classified(error) === 'path_rejected') throw fail('path_rejected');
      if (!repairCorruptStaging) throw fail('staged_corrupt');
      repairing = true;
    }
    const source = await fingerprintFile(
      sourceRoot,
      file.archive,
      file.bytes,
      plan.chunkBytes,
      plan.maxSourceBytes,
    );
    if (!sameFingerprint(source, file)) throw fail('source_changed');
    if (!repairing) {
      stats.reusedBytes += file.bytes;
      return 'reused';
    }
    // Only remove this generated staging object after the pinned source has revalidated.
    await checkedFile(stagingRoot, destination);
    await fs.unlink(existing.filename);
  }
  const source = await openChecked(sourceRoot, file.archive);
  let target, buffer, old;
  try {
    if (source.stat.size !== file.bytes) throw fail('source_changed');
    const partial = await checkedFile(stagingRoot, pending, true);
    target = partial.stat
      ? (await openChecked(stagingRoot, pending, constants.O_RDWR)).handle
      : await fs.open(
          partial.filename,
          constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
    let targetLength = (await target.stat()).size;
    const whole = createHash('sha256');
    for (let index = 0; index < file.chunks.length; index++) {
      const offset = index * plan.chunkBytes;
      buffer = Buffer.alloc(Math.min(plan.chunkBytes, file.bytes - offset));
      await readExactly(source.handle, buffer, offset);
      if (sha(buffer) !== file.chunks[index]) throw fail('source_changed');
      whole.update(buffer);
      let reused = false;
      if (targetLength >= offset + buffer.length) {
        old = Buffer.alloc(buffer.length);
        await readExactly(target, old, offset);
        reused = sha(old) === file.chunks[index];
        old.fill(0);
      }
      if (reused) stats.reusedBytes += buffer.length;
      else {
        await writeExactly(target, buffer, offset);
        targetLength = Math.max(targetLength, offset + buffer.length);
        stats.transferredBytes += buffer.length;
      }
      buffer.fill(0);
      if (onCheckpoint) await target.sync();
      await saveCheckpoint(
        { ...checkpoint, currentFile: file.sourceKey, verifiedChunks: index + 1 },
        onCheckpoint,
      );
    }
    const end = await checkedFile(sourceRoot, file.archive);
    if (
      whole.digest('hex') !== file.sha256 ||
      !unchanged(source.stat, await source.handle.stat()) ||
      !unchanged(source.stat, end.stat)
    )
      throw fail('source_changed');
    await target.truncate(file.bytes);
    await target.sync();
    await target.close();
    target = null;
    const verified = await fingerprintFile(
      stagingRoot,
      pending,
      file.bytes,
      plan.chunkBytes,
      plan.maxSourceBytes,
    );
    if (!sameFingerprint(verified, file)) throw fail('staged_corrupt');
    // link+unlink publishes without overwriting a concurrently created destination.
    await checkedFile(stagingRoot, pending);
    await fs.link(path.join(stagingRoot, pending), existing.filename);
    await fs.unlink(path.join(stagingRoot, pending));
    if (repairing) stats.repairedStagingFiles++;
    return 'transferred';
  } finally {
    buffer?.fill(0);
    old?.fill(0);
    await target?.close();
    await source.handle.close();
  }
}

/** Resume validates every old chunk and repairs partial chunks; completed corruption stops. */
export async function transferLegacyDeltaMedia({
  plan,
  sourceRoot,
  stagingRoot,
  checkpoint,
  onCheckpoint,
  repairCorruptStaging = false,
}) {
  checkPlan(plan);
  const roots = [await checkedRoot(sourceRoot), await checkedRoot(stagingRoot)];
  for (const [base, child] of [roots, [...roots].reverse()]) {
    const relative = path.relative(base, child);
    if (
      !relative ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw fail('path_rejected');
  }
  const receipt = checkpointFor(plan, checkpoint);
  if (typeof repairCorruptStaging !== 'boolean') throw fail('MEDIA_PLAN_INPUT_INVALID');
  const outcomes = [],
    stats = {
      transferred: 0,
      reused: 0,
      failed: 0,
      transferredBytes: 0,
      reusedBytes: 0,
      repairedStagingFiles: 0,
    };
  for (const file of plan.files) {
    let classification = file.classification;
    if (classification === 'ready') {
      try {
        stats[
          await transferOne({
            file,
            plan,
            sourceRoot: roots[0],
            stagingRoot: roots[1],
            checkpoint: receipt,
            onCheckpoint,
            stats,
            repairCorruptStaging,
          })
        ]++;
        receipt.transferredFiles.push(file.sourceKey);
      } catch (error) {
        if (error.mediaDeltaCode === 'MEDIA_CHECKPOINT_WRITE_FAILED') throw error;
        classification = classified(error);
      }
    }
    if (classification !== 'ready') stats.failed++;
    outcomes.push({ sourceKey: file.sourceKey, classification });
    await saveCheckpoint(receipt, onCheckpoint);
  }
  return {
    checkpoint: receipt,
    outcomes,
    summary: {
      ...stats,
      ok: planReady(plan) && stats.failed === 0,
      classifications: countBy(outcomes),
    },
  };
}

/**
 * Production bridge: pass an already-constructed MediaService and a metadata-only lookup.
 * No credentials/config/DB creation here. lookupObject returns camelCase MediaService rows.
 * bindSticker must idempotently check ownership before binding a user-sticker entry.
 */
export function createLegacyDeltaMediaPort({ media, lookupObject, adminId, bindSticker }) {
  if (!UUID.test(adminId) || !media || typeof lookupObject !== 'function')
    throw fail('MEDIA_PORT_INVALID');
  return {
    lookup: lookupObject,
    expectedHash: async (object, file) => {
      if (['chat_voice', 'generated_voice'].includes(object.purpose) || file.legacyVideo)
        return sha(file.bytes);
      const buffer = Buffer.from(file.bytes);
      try {
        return (await media.inspectLibraryImage({ buffer, mimetype: file.mimeType })).contentHash;
      } finally {
        buffer.fill(0);
      }
    },
    importLegacyObject: (object, file) =>
      media.importLegacyObject({
        id: object.id,
        ownerUserId: object.ownerUserId,
        purpose: object.purpose,
        adminId,
        bytes: file.bytes,
        mimeType: file.mimeType,
        durationMs: file.durationMs,
        legacyVideo: file.legacyVideo,
      }),
    readOwned: async (object) => {
      if (!(await media.canUse(object.ownerUserId, object.id, [object.purpose])))
        throw fail('access_rejected');
      return media.readBytes(object.id);
    },
    bindSticker,
  };
}
async function readVerifiedStaged(plan, stagingRoot, file) {
  let verified;
  const archive = `${file.sha256}.bin`;
  try {
    verified = await fingerprintFile(
      stagingRoot,
      archive,
      file.bytes,
      plan.chunkBytes,
      plan.maxSourceBytes,
    );
    if (!sameFingerprint(verified, file)) throw fail('staged_corrupt');
  } catch (error) {
    const code = classified(error);
    throw fail(
      code === 'missing' ? 'staged_missing' : code === 'path_rejected' ? code : 'staged_corrupt',
    );
  }
  const opened = await openChecked(stagingRoot, archive);
  const bytes = Buffer.alloc(file.bytes);
  try {
    await readExactly(opened.handle, bytes, 0);
    if (sha(bytes) !== file.sha256 || !unchanged(opened.stat, await opened.handle.stat()))
      throw fail('staged_corrupt');
    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  } finally {
    await opened.handle.close();
  }
}
function checkTarget(object, target, expectedHash) {
  if (!target || target.state !== 'ready') throw fail('target_not_ready');
  if (
    target.id !== object.id ||
    target.ownerId !== object.ownerUserId ||
    target.purpose !== object.purpose
  )
    throw fail('owner_conflict');
  if (target.contentHash !== expectedHash) throw fail('target_content_mismatch');
}

/** normalize must use the existing importer normalization/decoder; no external fetches. */
export async function importLegacyDeltaMedia({
  plan,
  stagingRoot,
  mediaPort,
  normalize,
  checkpoint,
  onCheckpoint,
}) {
  checkPlan(plan);
  if (
    typeof normalize !== 'function' ||
    !mediaPort ||
    ['lookup', 'expectedHash', 'importLegacyObject', 'readOwned'].some(
      (method) => typeof mediaPort[method] !== 'function',
    )
  )
    throw fail('MEDIA_PORT_INVALID');
  const root = await checkedRoot(stagingRoot);
  const receipt = checkpointFor(plan, checkpoint);
  const ready = new Map(),
    outcomes = [];
  const stats = { created: 0, reused: 0, failed: 0, verified: 0 };
  const files = new Map(plan.files.map((file) => [file.sourceKey, file]));
  for (const object of plan.objects) {
    let classification = object.classification;
    let source, normalized, readback;
    if (classification === 'ready') {
      try {
        source = await readVerifiedStaged(plan, root, files.get(object.sourceKey));
        try {
          normalized = await normalize(object, source);
          if (
            !(normalized?.bytes instanceof Uint8Array) ||
            !normalized.bytes.length ||
            typeof normalized.mimeType !== 'string'
          )
            throw fail('normalization_failed');
        } catch {
          throw fail('normalization_failed');
        }
        let expectedHash;
        try {
          expectedHash = await mediaPort.expectedHash(object, normalized);
        } catch {
          throw fail('normalization_failed');
        }
        if (!HASH.test(expectedHash)) throw fail('normalization_failed');
        const existing = await mediaPort.lookup(object.id);
        if (existing) checkTarget(object, existing, expectedHash);
        let created = false;
        if (!existing) {
          const result = await mediaPort.importLegacyObject(object, normalized);
          if (result?.mediaId !== object.id || typeof result.created !== 'boolean')
            throw fail('import_failed');
          created = result.created;
        }
        const target = await mediaPort.lookup(object.id);
        checkTarget(object, target, expectedHash);
        try {
          readback = await mediaPort.readOwned(object);
        } catch (error) {
          throw fail(classified(error, 'decrypt_failed'));
        }
        if (
          !(readback?.bytes instanceof Uint8Array) ||
          sha(readback.bytes) !== expectedHash ||
          readback.bytes.length !== Number(target.sizeBytes) ||
          readback.mimeType !== target.mimeType
        )
          throw fail('target_content_mismatch');
        if (object.purpose === 'user_sticker') {
          if (typeof mediaPort.bindSticker !== 'function') throw fail('binding_failed');
          try {
            await mediaPort.bindSticker(object);
          } catch {
            throw fail('binding_failed');
          }
        }
        stats[created ? 'created' : 'reused']++;
        stats.verified++;
        ready.set(object.id, {
          id: object.id,
          ownerUserId: object.ownerUserId,
          purpose: object.purpose,
          stickerId: object.stickerId ?? null,
          sourceSha256: files.get(object.sourceKey).sha256,
          contentHash: expectedHash,
        });
        receipt.importedObjects.push(object.id);
      } catch (error) {
        classification = classified(error, 'import_failed');
      } finally {
        source?.fill(0);
        normalized?.bytes?.fill(0);
        normalized?.legacyVideo?.posterPng?.fill(0);
        readback?.bytes?.fill(0);
      }
    }
    if (classification !== 'ready') stats.failed++;
    outcomes.push({ objectId: object.id, classification });
    await saveCheckpoint(receipt, onCheckpoint);
  }
  return {
    ready,
    checkpoint: receipt,
    outcomes,
    summary: {
      ...stats,
      ok: planReady(plan) && stats.failed === 0,
      classifications: countBy(outcomes),
    },
  };
}
