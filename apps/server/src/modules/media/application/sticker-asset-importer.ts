/** Operator-only local import. No HTTP contract, remote download, worker or supplier calls. */
import fs, { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { MEDIA_LIMITS, StickerPackWrite, StickerAdminEndpoints } from '@weiban/contracts';
import { AppError, type Database } from '../../../platform/index.js';
import { libraryStickers, stickerPacks } from '../infra/db/schema.js';
import { MediaService } from './media.js';
import { MediaAssetService } from './assets.js';
import { stickerImportId } from './sticker-import-id.js';

export class StickerImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new StickerImportError(code);
}
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/);
const sourceUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search
  );
});
export const StickerImportManifest = z.strictObject({
  version: z.literal(1),
  namespace: key,
  root: z.string().min(1).max(4096),
  source: z.strictObject({
    name: z.string().trim().min(1).max(200),
    url: sourceUrl,
    rightsNote: z.string().trim().min(1).max(2000),
  }),
  packs: z
    .array(
      z.strictObject({
        key,
        name: StickerPackWrite.shape.name,
        intro: StickerPackWrite.shape.intro,
        userVisible: z.boolean(),
        storeOrder: StickerPackWrite.shape.storeOrder,
        stickers: z
          .array(
            z.strictObject({
              path: z.string().min(1).max(4096),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              bytes: z.number().int().positive().max(5_000_000_000),
              description: StickerAdminEndpoints.addSticker.body!.shape.description,
              upstreamPath: z.string().min(1).max(4096).optional(),
              upstreamUrl: sourceUrl.optional(),
              // This must be supplied from actual review. Import authorization is NOT portrait review.
              review: z
                .strictObject({
                  confirmNoRealPersonPortrait: z.boolean(),
                  reference: z.string().trim().min(1).max(500),
                })
                .optional(),
            }),
          )
          .min(1)
          .max(50_000),
      }),
    )
    .min(1)
    .max(10_000),
});
export type StickerImportManifest = z.infer<typeof StickerImportManifest>;
type ImportItem = StickerImportManifest['packs'][number]['stickers'][number];

/** Check every component, not just the final file: symlinked roots/parents are rejected too. */
export function assertNoLinks(absolute: string, directory = false): fs.Stats {
  if (!path.isAbsolute(absolute)) fail('ABSOLUTE_PATH_REQUIRED');
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) fail('LINK_REJECTED');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail('LINK_REJECTED');
    if (index < parts.length - 1 && !stat.isDirectory()) fail('DIRECTORY_REQUIRED');
  }
  if (directory ? !stat.isDirectory() : !stat.isFile()) fail('REGULAR_FILE_REQUIRED');
  if (!directory && stat.nlink !== 1) fail('HARDLINK_REJECTED');
  return stat;
}
export async function readCheckedFile(
  absolute: string,
  maxBytes: number,
  expectedBytes?: number,
): Promise<Buffer> {
  const before = assertNoLinks(absolute);
  if (
    before.size < 1 ||
    before.size > maxBytes ||
    (expectedBytes !== undefined && before.size !== expectedBytes)
  )
    fail('FILE_SIZE_MISMATCH_OR_LIMIT');
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      fail('FILE_CHANGED_OR_LINKED');
    // Bounded read even if the file grows while being read.
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(buffer, size, buffer.length - size, null);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    const after = await handle.stat();
    const final = assertNoLinks(absolute);
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      final.dev !== opened.dev ||
      final.ino !== opened.ino ||
      final.size !== before.size
    )
      fail('FILE_CHANGED_DURING_READ');
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}
export async function readStickerImportManifest(file: string): Promise<{
  manifest: StickerImportManifest;
  manifestSha256: string;
}> {
  const bytes = await readCheckedFile(file, 32 * 1024 * 1024);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('MANIFEST_JSON_INVALID');
  }
  const parsed = StickerImportManifest.safeParse(raw);
  if (!parsed.success) fail('MANIFEST_SHAPE_INVALID');
  const manifest = parsed.data;
  if (!path.isAbsolute(manifest.root) || path.resolve(manifest.root) !== manifest.root)
    fail('ROOT_ABSOLUTE_CANONICAL_REQUIRED');
  const root = assertNoLinks(manifest.root, true);
  // The operator must stage under a non-shared root; no chmod of source data is performed.
  if (process.platform !== 'win32' && root.mode & 0o022)
    fail('ROOT_MUST_NOT_BE_GROUP_OR_WORLD_WRITABLE');
  if (new Set(manifest.packs.map((pack) => pack.key)).size !== manifest.packs.length)
    fail('DUPLICATE_PACK_KEY');
  const items = manifest.packs.flatMap((pack) => pack.stickers);
  if (items.length > 50_000 || items.reduce((n, item) => n + item.bytes, 0) > 5_000_000_000)
    fail('TOTAL_RESOURCE_LIMIT');
  return { manifest, manifestSha256: hash(bytes) };
}
export function stickerFilePath(root: string, relative: string): string {
  // Manifest paths are portable forward-slash paths; reject Windows drives/ADS/backslashes too.
  if (
    relative.includes('\\') ||
    relative.includes(':') ||
    relative.includes('\0') ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    fail('PATH_ESCAPE_REJECTED');
  const absolute = path.resolve(root, ...relative.split('/'));
  const rel = path.relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    fail('PATH_ESCAPE_REJECTED');
  return absolute;
}
export async function readStickerFile(
  root: string,
  item: ImportItem,
): Promise<{ buffer: Buffer; mimetype: string }> {
  const absolute = stickerFilePath(root, item.path);
  const mime: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mimetype = mime[path.extname(absolute).toLowerCase()];
  if (!mimetype) fail('FORMAT_REJECTED_SVG_NOT_SUPPORTED');
  const buffer = await readCheckedFile(absolute, MEDIA_LIMITS.imageMaxBytes, item.bytes);
  if (hash(buffer) !== item.sha256) fail('SHA256_MISMATCH');
  return { buffer, mimetype };
}
export function stickerImportErrorCode(error: unknown): string {
  if (error instanceof StickerImportError) return error.code;
  if (error instanceof AppError) return error.code;
  const code = (error as { code?: string } | null)?.code;
  if (code && ['ENOENT', 'EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'].includes(code))
    return `FILE_${code}`;
  return 'IMPORT_OPERATION_FAILED';
}
export interface StickerImportCounts {
  total: number;
  processed: number;
  rejected: number;
  createdPacks: number;
  existingPacks: number;
  publishedPacks: number;
  createdStickers: number;
  existingStickers: number;
  createdMedia: number;
  reusedMedia: number;
  wouldCreatePacks: number;
  wouldCreateStickers: number;
}
export class StickerAssetImporter {
  readonly counts: StickerImportCounts = {
    total: 0,
    processed: 0,
    rejected: 0,
    createdPacks: 0,
    existingPacks: 0,
    publishedPacks: 0,
    createdStickers: 0,
    existingStickers: 0,
    createdMedia: 0,
    reusedMedia: 0,
    wouldCreatePacks: 0,
    wouldCreateStickers: 0,
  };
  constructor(
    private readonly database: Database,
    private readonly media: MediaService,
    private readonly assets: MediaAssetService,
    private readonly activeAdmin: (id: string) => Promise<boolean>,
  ) {}
  async run(input: {
    manifest: StickerImportManifest;
    manifestSha256: string;
    adminId: string;
    apply: boolean;
    backupReference?: string;
    progress: (event: Record<string, unknown>) => void;
  }): Promise<StickerImportCounts> {
    const { manifest, adminId, apply, progress } = input;
    const assertAdmin = async () => {
      if (!(await this.activeAdmin(adminId))) fail('ACTIVE_ADMIN_REQUIRED');
    };
    await assertAdmin();
    this.counts.total = manifest.packs.reduce((n, pack) => n + pack.stickers.length, 0);
    for (const pack of manifest.packs) {
      const packId = stickerImportId('pack', manifest.namespace, pack.key);
      let [existingPack] = await this.database.db
        .select()
        .from(stickerPacks)
        .where(eq(stickerPacks.id, packId));
      let packCounted = false;
      let usable = 0;
      const seen = new Set<string>();
      for (const item of pack.stickers) {
        await assertAdmin();
        this.counts.processed++;
        let file: { buffer: Buffer; mimetype: string } | undefined;
        try {
          if (item.review?.confirmNoRealPersonPortrait !== true) fail('PORTRAIT_REVIEW_REQUIRED');
          file = await readStickerFile(manifest.root, item);
          const inspected = await this.media.inspectLibraryImage(file);
          const stickerId = stickerImportId('sticker', packId, inspected.contentHash);
          const [existing] = await this.database.db
            .select()
            .from(libraryStickers)
            .where(eq(libraryStickers.id, stickerId));
          if (existing && (existing.deletedAt || existing.packId !== packId))
            fail('EXISTING_STICKER_DELETED_OR_CONFLICT');
          if (existing) {
            const existingMedia = await this.media.findReady(existing.mediaId);
            if (
              !existingMedia ||
              existingMedia.ownerId !== null ||
              existingMedia.purpose !== 'sticker_library' ||
              existingMedia.contentHash !== inspected.contentHash
            )
              fail('EXISTING_STICKER_MEDIA_NOT_READY_OR_CONFLICT');
          }
          if (existingPack && (existingPack.name !== pack.name || existingPack.characterIds.length))
            fail('EXISTING_PACK_CLASSIFICATION_CONFLICT');
          if (!packCounted) {
            if (existingPack) this.counts.existingPacks++;
            else if (!apply) this.counts.wouldCreatePacks++;
            packCounted = true;
          }
          const provenance = {
            namespace: manifest.namespace,
            packKey: pack.key,
            source: manifest.source,
            manifestSha256: input.manifestSha256,
            sourcePath: item.path,
            sourceSha256: item.sha256,
            upstreamPath: item.upstreamPath ?? null,
            upstreamUrl: item.upstreamUrl ?? null,
            reviewReference: item.review.reference,
            backupReference: input.backupReference ?? null,
          };
          if (!existingPack && apply) {
            await assertAdmin();
            await this.assets.createPack(
              adminId,
              {
                name: pack.name,
                intro: pack.intro ?? `来源：${manifest.source.name}`.slice(0, 100),
                characterIds: [],
                userVisible: pack.userVisible,
                enabled: false,
                inStore: false,
                storeOrder: pack.storeOrder ?? 0,
              },
              { id: packId, provenance },
            );
            [existingPack] = await this.database.db
              .select()
              .from(stickerPacks)
              .where(eq(stickerPacks.id, packId));
            this.counts.createdPacks++;
          }
          if (existing || seen.has(stickerId)) {
            this.counts.existingStickers++;
            usable++;
            progress({
              status: 'exists',
              packKey: pack.key,
              path: item.path,
              packId,
              stickerId,
              counts: { ...this.counts },
            });
            continue;
          }
          if (apply) {
            await assertAdmin();
            const stored = await this.media.importLibraryImage(adminId, file, provenance);
            if (stored.created) this.counts.createdMedia++;
            else this.counts.reusedMedia++;
            await assertAdmin();
            await this.assets.addLibrarySticker(
              adminId,
              packId,
              {
                mediaId: stored.mediaId,
                description: item.description,
                confirmNoRealPersonPortrait: item.review.confirmNoRealPersonPortrait,
              },
              { id: stickerId, provenance },
            );
            this.counts.createdStickers++;
          } else this.counts.wouldCreateStickers++;
          seen.add(stickerId);
          usable++;
          progress({
            status: apply ? 'imported' : 'would_import',
            packKey: pack.key,
            path: item.path,
            packId,
            stickerId,
            counts: { ...this.counts },
          });
        } catch (error) {
          this.counts.rejected++;
          const code = stickerImportErrorCode(error);
          progress({
            status: 'rejected',
            packKey: pack.key,
            path: item.path,
            code,
            counts: { ...this.counts },
          });
          // Infrastructure failures stop promptly; there is no automated retry.
          if (
            code === 'IMPORT_OPERATION_FAILED' ||
            code === 'service_unavailable' ||
            code === 'ACTIVE_ADMIN_REQUIRED'
          )
            throw error;
        } finally {
          file?.buffer.fill(0);
        }
      }
      if (apply && usable > 0) {
        await assertAdmin();
        // Existing legal admin path publishes only packs containing usable, reviewed items.
        await this.assets.updatePack(adminId, packId, {
          enabled: true,
          inStore: true,
          userVisible: pack.userVisible,
          ...(pack.intro !== undefined ? { intro: pack.intro } : {}),
          ...(pack.storeOrder !== undefined ? { storeOrder: pack.storeOrder } : {}),
        });
        this.counts.publishedPacks++;
        progress({ status: 'published', packKey: pack.key, packId, counts: { ...this.counts } });
      }
    }
    return this.counts;
  }
}
