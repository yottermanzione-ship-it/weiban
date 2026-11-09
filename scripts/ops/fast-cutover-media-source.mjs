/** Old-host single-file read. stdin request/stdout binary frame only; no credentials or plaintext staging. */
import { constants } from 'node:fs';
import { lstat, realpath, open } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const MAX = 64 * 1024 * 1024;
const need = (value, code) => {
  if (!value) throw new Error(code);
};
const same = (a, b) =>
  ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => a[key] === b[key]);
const MEDIA_SUFFIXES = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
  '.heic',
  '.heif',
  '.wav',
  '.mp3',
  '.m4a',
  '.mp4',
  '.ogg',
  '.opus',
  '.webm',
  '.aac',
  '.flac',
  '.amr',
  '.silk',
]);

/** Same three asset subtrees for production and synthetic roots; never general project-file access. */
export function assertFastCutoverMediaPath(base, filename) {
  const inside = relative(base, filename);
  const parts = inside.split(sep);
  need(
    inside &&
      inside !== '..' &&
      !inside.startsWith('..' + sep) &&
      !isAbsolute(inside) &&
      parts.every((part) => part && !part.startsWith('.')),
    'FAST_MEDIA_SOURCE_PATH_REJECTED',
  );
  const normalized = parts.join('/');
  need(
    ['private/chat-media/', 'public/generated/', 'public/stickers/builtin/'].some((prefix) =>
      normalized.startsWith(prefix),
    ) && MEDIA_SUFFIXES.has(extname(filename).toLowerCase()),
    'FAST_MEDIA_SOURCE_PATH_REJECTED',
  );
}

/** asset is the private _media descriptor: {path,bytes,mtimeMs}. Missing means ENOENT only. */
export async function readFastCutoverSourceFile({ root, asset }) {
  need(
    typeof root === 'string' &&
      isAbsolute(root) &&
      typeof asset?.path === 'string' &&
      isAbsolute(asset.path) &&
      Number.isSafeInteger(asset.bytes) &&
      asset.bytes > 0 &&
      Number.isFinite(asset.mtimeMs),
    'FAST_MEDIA_SOURCE_INPUT_INVALID',
  );
  need(asset.bytes <= MAX, 'FAST_MEDIA_SOURCE_TOO_LARGE');
  let base;
  try {
    base = await realpath(root);
    need((await lstat(base)).isDirectory(), 'FAST_MEDIA_SOURCE_ROOT_INVALID');
  } catch {
    throw new Error('FAST_MEDIA_SOURCE_ROOT_INVALID');
  }
  let handle, bytes;
  try {
    const filename = resolve(asset.path);
    assertFastCutoverMediaPath(base, filename);
    const before = await lstat(filename);
    need(
      before.isFile() &&
        !before.isSymbolicLink() &&
        before.nlink === 1 &&
        (await realpath(filename)) === filename,
      'FAST_MEDIA_SOURCE_PATH_REJECTED',
    );
    need(
      before.size === asset.bytes && before.mtimeMs === asset.mtimeMs,
      'FAST_MEDIA_SOURCE_CHANGED',
    );
    handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    need(same(before, await handle.stat()), 'FAST_MEDIA_SOURCE_CHANGED');
    bytes = await handle.readFile();
    need(
      bytes.length === asset.bytes &&
        same(before, await handle.stat()) &&
        same(before, await lstat(filename)) &&
        (await realpath(filename)) === filename,
      'FAST_MEDIA_SOURCE_CHANGED',
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { status: 'file', bytes, sha256 };
  } catch (error) {
    bytes?.fill(0);
    if (error?.code === 'ENOENT') return { status: 'missing_file' };
    throw new Error(
      /^FAST_MEDIA_[A-Z_]+$/.test(String(error?.message))
        ? error.message
        : 'FAST_MEDIA_SOURCE_READ_FAILED',
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

/** Same pinned public-image hosts as the prior importer; HTTPS only, no cache or arbitrary URL fetches. */
export async function readFastCutoverSource({ root, asset }) {
  if (asset?.kind !== 'url') return readFastCutoverSourceFile({ root, asset });
  const safeUrl = (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('FAST_MEDIA_EXTERNAL_SOURCE_REJECTED');
    }
    need(
      url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        ['picsum.photos', 'fastly.picsum.photos'].includes(url.hostname),
      'FAST_MEDIA_EXTERNAL_SOURCE_REJECTED',
    );
    return url;
  };
  let url = safeUrl(asset.path);
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = safeUrl(new URL(response.headers.get('location'), url).href);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('FAST_MEDIA_EXTERNAL_SOURCE_FAILED');
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        need(size <= 10 * 1024 * 1024, 'FAST_MEDIA_SOURCE_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
      need(size > 0, 'FAST_MEDIA_SOURCE_EMPTY');
      const bytes = Buffer.concat(chunks);
      return { status: 'file', bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
    } finally {
      for (const chunk of chunks) chunk.fill(0);
    }
  }
  throw new Error('FAST_MEDIA_EXTERNAL_SOURCE_REDIRECTS');
}

/** Decode an SSH stdout Buffer retained only in process memory. Never print the frame. */
export function decodeFastCutoverMediaFrame(frame) {
  need(
    Buffer.isBuffer(frame) && frame.length >= 4 && frame.length <= MAX + 8196,
    'FAST_MEDIA_FRAME_INVALID',
  );
  const headerBytes = frame.readUInt32BE(0);
  need(
    headerBytes > 0 && headerBytes <= 8192 && frame.length >= 4 + headerBytes,
    'FAST_MEDIA_FRAME_INVALID',
  );
  let header;
  try {
    header = JSON.parse(frame.subarray(4, 4 + headerBytes).toString('utf8'));
  } catch {
    throw new Error('FAST_MEDIA_FRAME_INVALID');
  }
  const body = frame.subarray(4 + headerBytes);
  if (header.status === 'missing_file') {
    need(body.length === 0, 'FAST_MEDIA_FRAME_INVALID');
    return { status: 'missing_file' };
  }
  need(
    header.status === 'file' &&
      Number.isSafeInteger(header.bytes) &&
      header.bytes === body.length &&
      body.length > 0 &&
      /^[a-f0-9]{64}$/.test(header.sha256) &&
      createHash('sha256').update(body).digest('hex') === header.sha256,
    'FAST_MEDIA_FRAME_HASH_MISMATCH',
  );
  return { status: 'file', bytes: Buffer.from(body), sha256: header.sha256 };
}

async function cli() {
  need(!process.stdout.isTTY, 'FAST_MEDIA_PRIVATE_PIPE_REQUIRED');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    need(size <= 8192, 'FAST_MEDIA_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result = await readFastCutoverSource(request);
  const header = Buffer.from(
    JSON.stringify({
      status: result.status,
      ...(result.status === 'file' ? { bytes: result.bytes.length, sha256: result.sha256 } : {}),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const write = (chunk) =>
    new Promise((resolveWrite, reject) =>
      process.stdout.write(chunk, (error) => (error ? reject(error) : resolveWrite())),
    );
  try {
    await write(length);
    await write(header);
    if (result.bytes) await write(result.bytes);
  } finally {
    result.bytes?.fill(0);
  }
}
// esbuild folds this library into the target runner/transport. Only the source helper's
// own executable may consume stdin; an embedded library must never drain the private snapshot.
if (
  process.argv[1] &&
  basename(fileURLToPath(import.meta.url)) === 'fast-cutover-media-source.mjs' &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  cli().catch(() => {
    process.stderr.write('FAST_MEDIA_SOURCE_FAILED\n');
    process.exitCode = 1;
  });
