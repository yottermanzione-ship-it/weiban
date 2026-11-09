import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthResponse, LegacyFavoriteImportItem } from '@weiban/contracts';
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../src/data/upload.js', () => ({ uploadMedia: mocks.upload }));
import {
  LegacyFavoritesNative,
  type LegacyFavoritesBridge,
} from '../src/data/legacy-favorites-native.js';
import {
  attachLegacyFavoriteMedia,
  readLegacyFavoriteMedia,
} from '../src/data/legacy-favorites-media.js';

const userId = '11111111-1111-4111-8111-111111111111';
const auth = AuthResponse.parse({
  user: {
    userId,
    username: 'legacy1',
    role: 'user',
    profileCompleted: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  session: {
    sessionId: userId,
    kind: 'app',
    token: 'SYNTHETIC-MEDIA-ONLY-'.padEnd(48, 'x'),
    expiresAt: '2027-01-01T00:00:00.000Z',
  },
});
const owner = `${userId}:${userId}`;
const item = LegacyFavoriteImportItem.parse({
  accountKey: 'legacy1',
  itemKey: 'b'.repeat(64),
  favorite: {
    chatKey: 'role',
    chatTitle: '合成图片收藏',
    savedAt: 1720000000000,
    message: {
      type: 'image',
      content: '[图片]',
      imageUrl: '/synthetic-private-path/image.png',
      duration: null,
      extraSnapshot: { preserved: true },
    },
  },
});
type Request = {
  v: number;
  id: string;
  owner: string;
  type: string;
  accountKey: string;
  itemKey: string;
  snapshotDigest: string;
  offset: number;
  limit: number;
  sha256: string | null;
};
function setup(bytes = Buffer.from([1, 2, 3, 4, 5]), mimeType = 'image/png') {
  let current = true;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const requests: Request[] = [];
  let alter = (_request: Request, reply: Record<string, unknown>) => reply;
  const bridge: LegacyFavoritesBridge = {
    onmessage: null,
    postMessage: (raw) => {
      const request = JSON.parse(raw) as Request;
      requests.push(request);
      if (request.type === 'clear') return;
      const end = Math.min(bytes.length, request.offset + request.limit);
      const reply = {
        v: 1,
        id: request.id,
        owner: request.owner,
        ok: true,
        userId,
        snapshotDigest: request.snapshotDigest,
        accountKey: request.accountKey,
        itemKey: request.itemKey,
        mimeType,
        bytes: bytes.length,
        sha256,
        offset: request.offset,
        nextOffset: end < bytes.length ? end : null,
        base64: bytes.subarray(request.offset, end).toString('base64'),
      };
      queueMicrotask(() => bridge.onmessage?.({ data: JSON.stringify(alter(request, reply)) }));
    },
  };
  const native = new LegacyFavoritesNative(bridge);
  const controller = new AbortController();
  return {
    native,
    requests,
    bytes,
    sha256,
    controller,
    options: {
      auth,
      native,
      snapshotDigest: 'a'.repeat(64),
      item,
      signal: controller.signal,
      current: () => current,
    },
    change: (fn: typeof alter) => {
      alter = fn;
    },
    setCurrent: (value: boolean) => {
      current = value;
    },
  };
}
beforeEach(() => {
  mocks.upload.mockImplementation(async (purpose, file: Blob) => ({
    mediaId: userId,
    purpose,
    mimeType: file.type,
    sizeBytes: file.size,
  }));
});
afterEach(() => {
  vi.clearAllMocks();
});

it('reassembles bounded chunks, verifies the whole-file SHA-256 and sends only approved item identifiers', async () => {
  const original = Buffer.alloc(128 * 1024 + 19);
  for (let index = 0; index < original.length; index++) original[index] = index % 251;
  const lab = setup(original);
  const asset = await readLegacyFavoriteMedia(lab.options);
  expect(asset.status).toBe('ready');
  if (asset.status !== 'ready') throw new Error('fixture');
  expect(Buffer.from(await asset.blob.arrayBuffer())).toEqual(original);
  expect(lab.requests.map((request) => request.offset)).toEqual([0, 131072]);
  expect(lab.requests[0]!.sha256).toBeNull();
  expect(lab.requests[1]!.sha256).toBe(lab.sha256);
  expect(JSON.stringify(lab.requests)).not.toContain('synthetic-private-path');
  expect(JSON.stringify(lab.requests)).not.toContain(auth.session.token);
  lab.native.dispose(owner);
});

it.each(['sha', 'length', 'offset', 'owner', 'source', 'base64', 'next'] as const)(
  'refuses mixed or malformed attachment chunks: %s',
  async (mode) => {
    const lab = setup();
    lab.change((_request, reply) =>
      mode === 'sha'
        ? { ...reply, sha256: 'f'.repeat(64) }
        : mode === 'length'
          ? { ...reply, bytes: 17 * 1024 * 1024 }
          : mode === 'offset'
            ? { ...reply, offset: 7 }
            : mode === 'owner'
              ? { ...reply, userId: '22222222-2222-4222-8222-222222222222' }
              : mode === 'source'
                ? { ...reply, itemKey: 'c'.repeat(64) }
                : mode === 'base64'
                  ? { ...reply, base64: '%%%%' }
                  : { ...reply, nextOffset: 0 },
    );
    await expect(readLegacyFavoriteMedia(lab.options)).rejects.toMatchObject({
      code: mode === 'sha' ? 'file_changed' : 'invalid_reply',
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    lab.native.dispose(owner);
  },
);

it('a changed hash on the second chunk never produces a mixed file or uploads it', async () => {
  const lab = setup(Buffer.alloc(128 * 1024 + 1, 7));
  lab.change((request, reply) => (request.offset ? { ...reply, sha256: 'f'.repeat(64) } : reply));
  await expect(readLegacyFavoriteMedia(lab.options)).rejects.toMatchObject({
    code: 'file_changed',
  });
  expect(mocks.upload).not.toHaveBeenCalled();
  lab.native.dispose(owner);
});

it.each(['remote_reference', 'file_missing', 'media_unavailable'] as const)(
  'preserves snapshot with a distinct unavailable reason without fetching URLs: %s',
  async (reason) => {
    const lab = setup();
    lab.change((_request, reply) => ({
      v: 1,
      id: reply.id,
      owner,
      ok: false,
      reason,
      blocked: true,
      retryable: false,
    }));
    const result = await attachLegacyFavoriteMedia(lab.options);
    expect(result.item).toMatchObject({ favorite: item.favorite, mediaIssue: reason });
    expect(result.item.mediaId).toBeUndefined();
    expect(mocks.upload).not.toHaveBeenCalled();
    lab.native.dispose(owner);
  },
);

it('local attachment bytes are uploaded unchanged with the original captured session', async () => {
  const lab = setup();
  const result = await attachLegacyFavoriteMedia(lab.options);
  expect(result.item.mediaId).toBe(userId);
  expect(mocks.upload).toHaveBeenCalledOnce();
  const [purpose, blob, options] = mocks.upload.mock.calls[0]! as [
    string,
    Blob,
    { owner: { userId: string; sessionId: string; token: string }; signal: AbortSignal },
  ];
  expect(purpose).toBe('chat_image');
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(lab.bytes);
  expect(options.owner).toEqual({ userId, sessionId: userId, token: auth.session.token });
  expect(options.signal).toBe(lab.controller.signal);
  lab.native.dispose(owner);
});

it('voice duration beyond the existing upload limit leaves the full snapshot visible and pending', async () => {
  const lab = setup(Buffer.from([1, 2, 3]), 'audio/wav');
  lab.options.item = LegacyFavoriteImportItem.parse({
    ...item,
    favorite: {
      ...item.favorite,
      message: {
        type: 'voice',
        content: '[语音]',
        audioPath: '/synthetic/voice.wav',
        duration: 61,
      },
    },
  });
  expect(await attachLegacyFavoriteMedia(lab.options)).toMatchObject({
    unavailable: true,
    item: { mediaIssue: 'upload_limit_exceeded', favorite: lab.options.item.favorite },
  });
  expect(mocks.upload).not.toHaveBeenCalled();
  lab.native.dispose(owner);
});

it('accepts the media service normalizing a source PNG into different WebP bytes', async () => {
  const lab = setup();
  mocks.upload.mockResolvedValue({
    mediaId: userId,
    purpose: 'chat_image',
    mimeType: 'image/webp',
    sizeBytes: 127,
  });
  const result = await attachLegacyFavoriteMedia(lab.options);
  expect(result).toMatchObject({ unavailable: false, item: { mediaId: userId } });
  const source = mocks.upload.mock.calls[0]![1] as Blob;
  expect(source.type).toBe('image/png');
  expect(Buffer.from(await source.arrayBuffer())).toEqual(lab.bytes);
  lab.native.dispose(owner);
});

it('unsupported bytes and protected paths retain snapshots with explicit pending categories', async () => {
  const unsupported = setup(Buffer.from([1]), 'application/octet-stream');
  expect(await attachLegacyFavoriteMedia(unsupported.options)).toMatchObject({
    item: { mediaIssue: 'unsupported_media' },
  });
  unsupported.native.dispose(owner);
  const blocked = setup();
  blocked.change((_request, reply) => ({
    v: 1,
    id: reply.id,
    owner,
    ok: false,
    reason: 'path_rejected',
    blocked: true,
    retryable: false,
  }));
  expect(await attachLegacyFavoriteMedia(blocked.options)).toMatchObject({
    item: { mediaIssue: 'path_rejected' },
  });
  blocked.native.dispose(owner);
});

it('switching accounts after a native chunk prevents upload, and late upload success never attaches', async () => {
  const before = setup();
  before.change((_request, reply) => {
    before.setCurrent(false);
    return reply;
  });
  await expect(attachLegacyFavoriteMedia(before.options)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(mocks.upload).not.toHaveBeenCalled();
  before.native.dispose(owner);
  const after = setup();
  mocks.upload.mockImplementation(async (purpose, file: Blob) => {
    after.setCurrent(false);
    return { mediaId: userId, purpose, sizeBytes: file.size, mimeType: file.type };
  });
  await expect(attachLegacyFavoriteMedia(after.options)).rejects.toMatchObject({
    name: 'AbortError',
  });
  after.native.dispose(owner);
});

it('upload failure keeps a retryable unavailable snapshot instead of suppressing other favorites', async () => {
  const lab = setup();
  mocks.upload.mockRejectedValue(new Error('synthetic offline'));
  expect(await attachLegacyFavoriteMedia(lab.options)).toMatchObject({
    unavailable: true,
    item: { mediaIssue: 'media_unavailable', favorite: item.favorite },
  });
  lab.native.dispose(owner);
});
