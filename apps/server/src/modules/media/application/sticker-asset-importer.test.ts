import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { StickerPackWrite, StickerAdminEndpoints } from '@weiban/contracts';
import {
  StickerAssetImporter,
  StickerImportManifest,
  readStickerImportManifest,
  readStickerFile,
  stickerFilePath,
  type StickerImportCounts,
} from './sticker-asset-importer.js';
import { stickerImportId } from './sticker-import-id.js';
import { MediaService } from './media.js';
import { MediaAssetService } from './assets.js';
import { libraryStickers, stickerPacks } from '../infra/db/schema.js';
import type { Database } from '../../../platform/index.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const decoder = Object.create(MediaService.prototype) as MediaService;
const adminId = '4eafcf1d-04a0-41ec-b89b-d7e3baf82d42';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'wb-sticker-import-'));
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#f80' } })
    .png()
    .toBuffer();
  await writeFile(path.join(root, 'a.png'), bytes);
  const item = {
    path: 'a.png',
    bytes: bytes.length,
    sha256: sha(bytes),
    description: '测试图',
    review: { confirmNoRealPersonPortrait: true, reference: 'synthetic test fixture; no person' },
  };
  const manifest = StickerImportManifest.parse({
    version: 1,
    namespace: 'test-v1',
    root,
    source: {
      name: 'test fixtures',
      url: 'https://example.org/fixtures',
      rightsNote: 'Synthetic unit test only',
    },
    packs: [{ key: 'original-category', name: '原包分类', userVisible: true, stickers: [item] }],
  });
  return { root, bytes, item, manifest };
}
function memoryRuntime() {
  const packs: Array<Record<string, unknown>> = [];
  const stickers: Array<Record<string, unknown>> = [];
  const mediaRows = new Map<string, { ownerId: null; purpose: string; contentHash: string }>();
  let writes = 0;
  const database = {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () =>
            table === stickerPacks ? packs : table === libraryStickers ? stickers : [],
        }),
      }),
    },
  } as unknown as Database;
  const media = {
    inspectLibraryImage: decoder.inspectLibraryImage.bind(decoder),
    findReady: async (id: string) => mediaRows.get(id) ?? null,
    importLibraryImage: async (_admin: string, file: { buffer: Buffer; mimetype: string }) => {
      const inspected = await decoder.inspectLibraryImage(file);
      const created = !mediaRows.has(inspected.mediaId);
      if (created) {
        writes++;
        mediaRows.set(inspected.mediaId, {
          ownerId: null,
          purpose: 'sticker_library',
          contentHash: inspected.contentHash,
        });
      }
      return { mediaId: inspected.mediaId, created };
    },
  } as unknown as MediaService;
  const assets = {
    createPack: async (_admin: string, body: unknown, identity: { id: string }) => {
      const parsed = StickerPackWrite.parse(body);
      assert.equal(parsed.enabled, false);
      assert.equal(parsed.inStore, false);
      writes++;
      packs.push({ id: identity.id, ...parsed });
    },
    addLibrarySticker: async (
      _admin: string,
      packId: string,
      body: unknown,
      identity: { id: string },
    ) => {
      const parsed = StickerAdminEndpoints.addSticker.body!.parse(body);
      writes++;
      stickers.push({ id: identity.id, packId, ...parsed, deletedAt: null });
    },
    updatePack: async (_admin: string, _id: string, body: unknown) => {
      const parsed = StickerPackWrite.partial().parse(body);
      assert.equal(parsed.enabled, true);
      assert.equal(parsed.inStore, true);
      writes++;
      Object.assign(packs[0]!, parsed);
    },
  } as unknown as MediaAssetService;
  return {
    database,
    media,
    assets,
    packs,
    stickers,
    mediaRows,
    get writes() {
      return writes;
    },
  };
}

test('manifest parsing preserves upstream provenance, requires limits, and rejects duplicate keys', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'import.json');
    f.manifest.packs[0]!.stickers[0]!.upstreamUrl =
      'https://raw.githubusercontent.com/x/y/main/a.png';
    f.manifest.packs[0]!.stickers[0]!.upstreamPath = 'original/a.png';
    await writeFile(file, JSON.stringify(f.manifest));
    const result = await readStickerImportManifest(file);
    assert.equal(result.manifest.packs[0]!.stickers[0]!.upstreamPath, 'original/a.png');
    assert.equal(result.manifestSha256.length, 64);
    await writeFile(
      file,
      JSON.stringify({ ...f.manifest, packs: [f.manifest.packs[0], f.manifest.packs[0]] }),
    );
    await assert.rejects(readStickerImportManifest(file), /DUPLICATE_PACK_KEY/);
    assert.equal(
      StickerImportManifest.safeParse({
        ...f.manifest,
        source: { ...f.manifest.source, url: 'https://x.invalid/?token=secret' },
      }).success,
      false,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('path traversal, SHA mismatch, oversize and hardlinked sources are refused', async () => {
  const f = await fixture();
  try {
    for (const value of [
      '../a.png',
      '/a.png',
      'x/../a.png',
      'C:/a.png',
      'x\\a.png',
      'a.png:stream',
      './a.png',
    ])
      assert.throws(() => stickerFilePath(f.root, value), /PATH_ESCAPE/);
    await assert.rejects(
      readStickerFile(f.root, { ...f.item, sha256: '0'.repeat(64) }),
      /SHA256_MISMATCH/,
    );
    await assert.rejects(
      readStickerFile(f.root, { ...f.item, bytes: 11 * 1024 * 1024 }),
      /FILE_SIZE/,
    );
    await link(path.join(f.root, 'a.png'), path.join(f.root, 'hard.png'));
    await assert.rejects(readStickerFile(f.root, f.item), /HARDLINK_REJECTED/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('real upload decoder accepts PNG/JPEG/GIF/WebP and rejects fake or mismatched images', async () => {
  const base = sharp({ create: { width: 2, height: 2, channels: 3, background: '#0af' } });
  for (const [format, mimetype] of [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['webp', 'image/webp'],
  ] as const) {
    const buffer = await base.clone().toFormat(format).toBuffer();
    const first = await decoder.inspectLibraryImage({ buffer, mimetype });
    const again = await decoder.inspectLibraryImage({ buffer, mimetype });
    assert.equal(first.mediaId, again.mediaId);
    assert.equal(first.contentHash.length, 64);
  }
  await assert.rejects(
    decoder.inspectLibraryImage({ buffer: Buffer.from('not png'), mimetype: 'image/png' }),
  );
  await assert.rejects(
    decoder.inspectLibraryImage({ buffer: await base.png().toBuffer(), mimetype: 'image/gif' }),
  );
  await assert.rejects(
    decoder.inspectLibraryImage({ buffer: Buffer.from('<svg/>'), mimetype: 'image/svg+xml' }),
  );
});

test('preview does no writes, deduplicates content and reports missing portrait review/SVG', async () => {
  const f = await fixture();
  const runtime = memoryRuntime();
  try {
    const noReview = { ...f.item, path: 'missing.png', review: undefined };
    f.manifest.packs[0]!.stickers.push({ ...f.item }, noReview, { ...f.item, path: 'a.svg' });
    const progress: unknown[] = [];
    const importer = new StickerAssetImporter(
      runtime.database,
      runtime.media,
      runtime.assets,
      async () => true,
    );
    const counts = await importer.run({
      manifest: f.manifest,
      manifestSha256: 'a'.repeat(64),
      adminId,
      apply: false,
      progress: (event) => progress.push(event),
    });
    assert.equal(runtime.writes, 0);
    assert.equal(counts.wouldCreatePacks, 1);
    assert.equal(counts.wouldCreateStickers, 1);
    assert.equal(counts.existingStickers, 1);
    assert.equal(counts.rejected, 2);
    assert.equal(progress.length, 4);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('apply uses legal services to publish; rerun does not duplicate pack/sticker/media', async () => {
  const f = await fixture();
  const runtime = memoryRuntime();
  try {
    const run = async (): Promise<StickerImportCounts> =>
      new StickerAssetImporter(
        runtime.database,
        runtime.media,
        runtime.assets,
        async () => true,
      ).run({
        manifest: f.manifest,
        manifestSha256: 'a'.repeat(64),
        adminId,
        apply: true,
        backupReference: 'synthetic-backup',
        progress: () => {},
      });
    const first = await run();
    const second = await run();
    assert.equal(first.createdPacks, 1);
    assert.equal(first.createdMedia, 1);
    assert.equal(first.createdStickers, 1);
    assert.equal(second.createdPacks, 0);
    assert.equal(second.createdMedia, 0);
    assert.equal(second.createdStickers, 0);
    assert.equal(second.existingStickers, 1);
    assert.equal(second.publishedPacks, 1);
    assert.equal(runtime.packs.length, 1);
    assert.equal(runtime.stickers.length, 1);
    assert.equal(runtime.mediaRows.size, 1);
    assert.equal(runtime.packs[0]!.enabled, true);
    assert.equal(runtime.packs[0]!.inStore, true);
    assert.equal(runtime.packs[0]!.userVisible, true);
    assert.equal(
      runtime.packs[0]!.id,
      stickerImportId('pack', f.manifest.namespace, 'original-category'),
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('inactive administrators are rejected before reads/writes; partial error preserves progress', async () => {
  const f = await fixture();
  const runtime = memoryRuntime();
  try {
    const denied = new StickerAssetImporter(
      runtime.database,
      runtime.media,
      runtime.assets,
      async () => false,
    );
    await assert.rejects(
      denied.run({
        manifest: f.manifest,
        manifestSha256: 'a'.repeat(64),
        adminId,
        apply: true,
        progress: () => {},
      }),
      /ACTIVE_ADMIN_REQUIRED/,
    );
    assert.equal(runtime.writes, 0);
    f.manifest.packs[0]!.stickers.push({ ...f.item, sha256: '0'.repeat(64) });
    const importer = new StickerAssetImporter(
      runtime.database,
      runtime.media,
      runtime.assets,
      async () => true,
    );
    const counts = await importer.run({
      manifest: f.manifest,
      manifestSha256: 'a'.repeat(64),
      adminId,
      apply: true,
      progress: () => {},
    });
    assert.equal(counts.createdStickers, 1);
    assert.equal(counts.rejected, 1);
    assert.equal(counts.publishedPacks, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
