import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { and, count, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import {
  MEDIA_LIMITS,
  MediaPurpose as MediaPurposeSchema,
  type MediaObject,
  type MediaReadPort,
  type MediaPurpose,
  type MediaSystemPort,
  type MediaTranscriptPort,
  type MediaTranscript,
  type Tx,
  type UserDataOwner,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  AUDIT_LOG,
  CHARACTER_PURGE_REGISTRY,
  CLOCK,
  JOB_QUEUE,
  DATABASE,
  ENVELOPE_CRYPTO,
  PLATFORM_KEY_OWNER,
  USER_DATA_REGISTRY,
  AppError,
  asDbTx,
  newId,
  type AppConfig,
  type AuditLog,
  type CharacterPurgeRegistry,
  type Clock,
  type JobQueue,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { objects, userStickers, userStickerPacks } from '../infra/db/schema.js';
import {
  MEDIA_STORAGE,
  MEDIA_SYNC,
  MEDIA_ACCOUNT_STATUS,
  type MediaAccountStatus,
  type MediaStorageAudit,
  type MediaSync,
} from '../tokens.js';
import type { ObjectStorage } from '../infra/storage.js';
import { isBuiltinKey, renderBuiltinSvg } from './builtin-art.js';
import { stickerImportId } from './sticker-import-id.js';
type Row = typeof objects.$inferSelect;

/** 素材库用途：所有者为空（平台），所有登录用户可读，只能管理员上传。 */
const LIBRARY_PURPOSES: ReadonlySet<string> = new Set([
  'character_avatar',
  'sticker_library',
  'voice_sample',
  'card_template',
  'pet_art',
  'plaza_avatar',
]);
/** 音频用途；其余都是图片。 */
const AUDIO_PURPOSES: ReadonlySet<string> = new Set([
  'chat_voice',
  'generated_voice',
  'voice_sample',
]);
/** 缩略图短边（契约 MediaObject.thumbnailUrl 注释）。 */
const THUMB_SHORT_SIDE = 360;
/** 访问链接有效期。 */
const LINK_TTL_MS = 5 * 60 * 1000;
/** 素材音频（试听、关怀兜底、角色语音）最长 5 分钟。 */
const LONG_AUDIO_MAX_MS = 5 * 60_000;
const LONG_AUDIO_MAX_BYTES = MEDIA_LIMITS.imageMaxBytes;

const IMAGE_FORMAT_MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function isAudioPurpose(purpose: string): boolean {
  return AUDIO_PURPOSES.has(purpose);
}

/** 按文件头判断音频格式；返回规范的 MIME，认不出为 null。 */
export function sniffAudioMime(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'audio/webm';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return 'audio/aac';
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

interface Processed {
  body: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  thumb: Buffer | null;
  durationMs: number | null;
}

@Injectable()
export class MediaService
  implements UserDataOwner, OnModuleInit, MediaReadPort, MediaSystemPort, MediaTranscriptPort
{
  readonly module = 'media';
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(MEDIA_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly purgeRegistry: CharacterPurgeRegistry,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(MEDIA_ACCOUNT_STATUS) private readonly accounts: MediaAccountStatus,
    @Optional() @Inject(MEDIA_SYNC) private readonly sync: MediaSync | null = null,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    this.purgeRegistry.register({
      module: 'media',
      purge: (tx, characterId) => this.purgeCharacter(tx, characterId),
    });
    await this.jobs.work('media.recover_uploads', () => this.recoverUploads());
    await this.jobs.schedule('media.recover_uploads', '*/10 * * * *');
    await this.jobs.work('media.lifecycle', () => this.runLifecycle());
    await this.jobs.schedule('media.lifecycle', '17 * * * *');
  }

  // ---------- 生命周期 ----------

  /** 后台彻底删除角色：从素材库「指定角色」的表情包数组里移除该角色（无外键，JSONB 映射）。 */
  private async purgeCharacter(tx: DbTx, characterId: string): Promise<void> {
    await tx.query(
      `UPDATE media.sticker_packs
          SET character_ids = character_ids - $1::text
        WHERE jsonb_exists(character_ids, $1)`,
      [characterId],
    );
  }

  /** 回收超过 10 分钟仍是 pending 的上传（上传中途崩溃）。 */
  async recoverUploads(): Promise<void> {
    const pending = await this.database.db
      .select()
      .from(objects)
      .where(
        and(
          eq(objects.state, 'pending'),
          lt(objects.createdAt, new Date(this.clock.nowMs() - 600000)),
        ),
      )
      .limit(100);
    for (const row of pending) await this.removeRow(row);
  }

  /**
   * 对象生命周期（每小时）：
   * 1. 过期对象（expires_at 已到）物理删除；
   * 2. 删除中途失败的对象（state = deleting）重试删除，保证存储里不留孤儿文件。
   */
  async runLifecycle(): Promise<void> {
    const now = this.clock.now();
    const rows = await this.database.db
      .select()
      .from(objects)
      .where(
        or(
          and(isNotNull(objects.expiresAt), lt(objects.expiresAt, now)),
          eq(objects.state, 'deleting'),
        ),
      )
      .limit(200);
    for (const row of rows) {
      try {
        await this.removeRow(row);
      } catch {
        // 存储暂时不可用：保留记录，下次重试。
      }
    }
  }

  private async removeRow(row: Row): Promise<void> {
    await this.database.db.update(objects).set({ state: 'deleting' }).where(eq(objects.id, row.id));
    if (!isBuiltinKey(row.storageKey)) await this.storage.delete(row.storageKey);
    if (row.thumbStorageKey) await this.storage.delete(row.thumbStorageKey);
    await this.database.db.delete(objects).where(eq(objects.id, row.id));
  }

  // ---------- 上传 ----------

  async upload(
    userId: string,
    purpose: MediaPurpose,
    file: { buffer: Buffer; mimetype: string },
    options: { admin?: boolean; durationMs?: number | null } = {},
  ): Promise<MediaObject> {
    const admin = options.admin ?? false;
    if (LIBRARY_PURPOSES.has(purpose) && !admin)
      throw new AppError('forbidden', '此用途需要管理员权限');
    if (!file?.buffer?.length) throw new AppError('bad_request', '没有收到文件');
    const processed = isAudioPurpose(purpose)
      ? this.processAudio(purpose, file, options.durationMs ?? null)
      : await this.processImage(file.buffer, file.mimetype);
    const ownerId = LIBRARY_PURPOSES.has(purpose) ? null : userId;
    const row = await this.store({
      ownerId,
      purpose,
      processed,
      transcriptStatus: purpose === 'chat_voice' ? 'pending' : null,
    });
    if (admin)
      await this.audit.record({
        module: 'media',
        action: 'asset.uploaded',
        actorType: 'admin',
        actorId: userId,
        targetType: 'media',
        targetId: row.id,
        details: { purpose, mimeType: row.mimeType, sizeBytes: row.sizeBytes },
      });
    return this.toMedia(row, userId);
  }

  /** Maintenance-only preview: exactly the upload decoder, without DB/storage/crypto writes. */
  async inspectLibraryImage(file: { buffer: Buffer; mimetype: string }): Promise<{
    mediaId: string;
    contentHash: string;
  }> {
    const processed = await this.processImage(file.buffer, file.mimetype);
    try {
      const contentHash = createHash('sha256').update(processed.body).digest('hex');
      return { mediaId: stickerImportId('media', contentHash), contentHash };
    } finally {
      processed.body.fill(0);
      processed.thumb?.fill(0);
    }
  }

  /** Called only by the controlled importer after active-admin and review checks. */
  async importLibraryImage(
    adminId: string,
    file: { buffer: Buffer; mimetype: string },
    provenance: Record<string, unknown>,
  ): Promise<{ mediaId: string; created: boolean }> {
    const processed = await this.processImage(file.buffer, file.mimetype);
    try {
      const contentHash = createHash('sha256').update(processed.body).digest('hex');
      const id = stickerImportId('media', contentHash);
      const [existing] = await this.database.db.select().from(objects).where(eq(objects.id, id));
      if (existing) {
        if (
          existing.state !== 'ready' ||
          existing.ownerId !== null ||
          existing.purpose !== 'sticker_library' ||
          existing.contentHash !== contentHash
        )
          throw new AppError('conflict', '导入媒体ID已有非就绪或不匹配记录；保留进度，先人工核查');
        return { mediaId: id, created: false };
      }
      // Also reuse pre-existing platform library images with the same decoded bytes.
      const [same] = await this.database.db
        .select()
        .from(objects)
        .where(
          and(
            eq(objects.purpose, 'sticker_library'),
            eq(objects.state, 'ready'),
            isNull(objects.ownerId),
            eq(objects.contentHash, contentHash),
          ),
        );
      if (same?.ownerId === null) return { mediaId: same.id, created: false };
      const row = await this.store({
        id,
        ownerId: null,
        purpose: 'sticker_library',
        processed,
        transcriptStatus: null,
        importAudit: { adminId, provenance },
      });
      return { mediaId: row.id, created: true };
    } finally {
      processed.body.fill(0);
      processed.thumb?.fill(0);
    }
  }

  private processAudio(
    purpose: string,
    file: { buffer: Buffer; mimetype: string },
    durationMs: number | null,
  ): Processed {
    const declared = (file.mimetype ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(MEDIA_LIMITS.voiceMimeTypes as readonly string[]).includes(declared))
      throw new AppError('bad_request', '语音格式不支持');
    const sniffed = sniffAudioMime(file.buffer);
    if (!sniffed) throw new AppError('bad_request', '语音文件无法识别');
    const isChat = purpose === 'chat_voice';
    const maxBytes = isChat ? MEDIA_LIMITS.voiceMaxBytes : LONG_AUDIO_MAX_BYTES;
    const maxMs = isChat ? MEDIA_LIMITS.voiceMaxDurationMs : LONG_AUDIO_MAX_MS;
    if (file.buffer.length > maxBytes) throw new AppError('bad_request', '语音文件过大');
    if (durationMs === null && isChat) throw new AppError('bad_request', '缺少语音时长');
    if (
      durationMs !== null &&
      (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > maxMs)
    )
      throw new AppError('bad_request', '语音时长不符合要求');
    return {
      body: Buffer.from(file.buffer),
      mimeType: sniffed,
      width: null,
      height: null,
      thumb: null,
      durationMs,
    };
  }

  /** 解码后重编码：去掉 EXIF/GPS、尾部附加数据，统一 WebP；同时生成短边 360px 的缩略图。 */
  private async processImage(buffer: Buffer, declaredMime: string): Promise<Processed> {
    if (
      buffer.length > MEDIA_LIMITS.imageMaxBytes ||
      !(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(declaredMime)
    )
      throw new AppError('bad_request', '图片格式或大小不符合要求');
    try {
      const image = sharp(buffer, { animated: true, limitInputPixels: 40000000, failOn: 'error' });
      const meta = await image.metadata();
      const mime = IMAGE_FORMAT_MIME[meta.format ?? ''];
      if (
        !mime ||
        mime !== declaredMime ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > 40000000
      )
        throw new Error('unsupported image');
      const encoded = await image
        .clone()
        .rotate()
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      if (encoded.data.length > MEDIA_LIMITS.imageMaxBytes) throw new Error('image too large');
      const width = encoded.info.width;
      const height = encoded.info.pageHeight ?? encoded.info.height;
      let thumb: Buffer | null = null;
      if (Math.min(width, height) > THUMB_SHORT_SIDE) {
        thumb = await sharp(encoded.data, { animated: true })
          .resize(
            width <= height
              ? { width: THUMB_SHORT_SIDE, withoutEnlargement: true }
              : { height: THUMB_SHORT_SIDE, withoutEnlargement: true },
          )
          .webp({ quality: 75 })
          .toBuffer();
      }
      return { body: encoded.data, mimeType: 'image/webp', width, height, thumb, durationMs: null };
    } catch {
      throw new AppError('bad_request', '图片无法解码或像素过大');
    }
  }

  /** 先登记 pending，写入加密对象（含缩略图），最后置 ready；失败清理。 */
  private async store(input: {
    /** Internal import identity only; never accepted from an HTTP request. */
    id?: string;
    importAudit?: { adminId: string; provenance: Record<string, unknown> };
    ownerId: string | null;
    purpose: string;
    processed: Processed;
    transcriptStatus: string | null;
    expiresAt?: Date | null;
  }): Promise<Row> {
    const { processed } = input;
    const id = input.id ?? newId();
    const storageKey = `${id}.sealed`;
    const thumbStorageKey = processed.thumb ? `${newId()}.sealed` : null;
    const keyOwner = input.ownerId ?? PLATFORM_KEY_OWNER;
    const contentHash = createHash('sha256').update(processed.body).digest('hex');
    const [row] = await this.database.db
      .insert(objects)
      .values({
        id,
        ownerId: input.ownerId,
        purpose: input.purpose,
        mimeType: processed.mimeType,
        sizeBytes: processed.body.length,
        width: processed.width,
        height: processed.height,
        storageKey,
        thumbStorageKey,
        durationMs: processed.durationMs,
        transcriptStatus: input.transcriptStatus,
        contentHash,
        expiresAt: input.expiresAt ?? null,
        state: 'pending',
        createdAt: this.clock.now(),
      })
      .returning();
    if (!row) throw new Error('媒体元数据写入失败');
    try {
      return await this.database.transaction(async (tx) => {
        // pending保留在事务外，进程中断后仍能按元数据回收对象；用户状态行锁
        // 则覆盖DEK生成、文件写入和ready提交，注销不能在中间销毁再重建密钥。
        if (input.ownerId && (await this.accounts.getAccountStatus(input.ownerId, tx)) !== 'active')
          throw new AppError('unauthenticated', '账号已失效');
        await this.storage.put(
          storageKey,
          await this.crypto.seal(keyOwner, `media:${id}`, processed.body, tx),
        );
        if (thumbStorageKey && processed.thumb)
          await this.storage.put(
            thumbStorageKey,
            await this.crypto.seal(keyOwner, `media-thumb:${id}`, processed.thumb, tx),
          );
        const [ready] = await tx.db
          .update(objects)
          .set({ state: 'ready' })
          .where(and(eq(objects.id, id), eq(objects.state, 'pending')))
          .returning();
        if (!ready) {
          await this.storage.delete(storageKey);
          if (thumbStorageKey) await this.storage.delete(thumbStorageKey);
          throw new AppError('not_found', '媒体已删除');
        }
        if (input.importAudit)
          await this.audit.record(
            {
              module: 'media',
              action: 'asset.uploaded',
              actorType: 'admin',
              actorId: input.importAudit.adminId,
              targetType: 'media',
              targetId: id,
              details: {
                purpose: input.purpose,
                mimeType: ready.mimeType,
                sizeBytes: ready.sizeBytes,
                import: input.importAudit.provenance,
              },
            },
            tx,
          );
        return ready;
      });
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      if (thumbStorageKey) await this.storage.delete(thumbStorageKey).catch(() => undefined);
      await this.database.db.delete(objects).where(eq(objects.id, id));
      if (error instanceof AppError) throw error;
      throw new AppError('service_unavailable', '媒体存储暂时不可用');
    } finally {
      processed.body.fill(0);
      processed.thumb?.fill(0);
    }
  }

  // ---------- 读取与访问链接 ----------

  async getMedia(userId: string, mediaId: string): Promise<MediaObject> {
    const row = await this.get(mediaId);
    if (row.ownerId !== null && row.ownerId !== userId)
      throw new AppError('not_found', '找不到媒体');
    return this.toMedia(row, userId);
  }

  /** 内部：读一行 ready 的元数据（不检查归属）。 */
  async findReady(id: string): Promise<Row | null> {
    const [row] = await this.database.db
      .select()
      .from(objects)
      .where(and(eq(objects.id, id), eq(objects.state, 'ready')));
    return row ?? null;
  }

  private async get(id: string): Promise<Row> {
    const row = await this.findReady(id);
    if (!row) throw new AppError('not_found', '找不到媒体');
    return row;
  }

  private async linkFor(row: Row, userId: string, variant: 'o' | 't', expires: Date) {
    const token = (
      await this.crypto.seal(
        PLATFORM_KEY_OWNER,
        `media-link:${row.id}`,
        JSON.stringify({ userId, expiresAt: expires.getTime(), v: variant }),
      )
    ).toString('base64url');
    const url = new URL(`/api/v1/media/${row.id}/content`, this.config.media.publicBaseUrl);
    url.searchParams.set('token', token);
    return url.toString();
  }

  async toMedia(row: Row, userId: string): Promise<MediaObject> {
    const expires = new Date(this.clock.nowMs() + LINK_TTL_MS);
    const url = await this.linkFor(row, userId, 'o', expires);
    const isImage = row.mimeType.startsWith('image/');
    const thumbnailUrl = !isImage
      ? null
      : row.thumbStorageKey
        ? await this.linkFor(row, userId, 't', expires)
        : url;
    const purpose = MediaPurposeSchema.safeParse(row.purpose);
    return {
      mediaId: row.id,
      purpose: (purpose.success ? purpose.data : 'chat_image') as MediaPurpose,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      url,
      urlExpiresAt: expires.toISOString(),
      createdAt: row.createdAt.toISOString(),
      thumbnailUrl,
      durationMs: row.durationMs,
    };
  }

  /** 给某用户取一个媒体的访问链接（素材库或本人的）；内部模块用，不存在返回 null。 */
  async urlFor(userId: string, mediaId: string): Promise<string | null> {
    const row = await this.findReady(mediaId);
    if (!row || (row.ownerId !== null && row.ownerId !== userId)) return null;
    return this.linkFor(row, userId, 'o', new Date(this.clock.nowMs() + LINK_TTL_MS));
  }

  /**
   * @param accept 请求的 Accept 头。内置素材平时给 SVG；客户端只要位图时
   * （Accept 有 image/webp 或 image/png 但没有 image/svg+xml，例如安卓）现场转 WebP / PNG。
   */
  async download(
    mediaId: string,
    token: string,
    accept?: string,
  ): Promise<{ body: Buffer; mimeType: string }> {
    if (!token || token.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(token))
      throw new AppError('forbidden', '访问链接无效');
    let grant: { userId: string; expiresAt: number; v?: 'o' | 't' };
    try {
      const plain = await this.crypto.open(
        PLATFORM_KEY_OWNER,
        `media-link:${mediaId}`,
        Buffer.from(token, 'base64url'),
      );
      try {
        grant = JSON.parse(plain.toString('utf8')) as typeof grant;
      } finally {
        plain.fill(0);
      }
      if (!Number.isFinite(grant.expiresAt) || grant.expiresAt <= this.clock.nowMs())
        throw new Error('expired');
    } catch {
      throw new AppError('forbidden', '访问链接已过期或无效');
    }
    const row = await this.get(mediaId);
    if (row.ownerId !== null && row.ownerId !== grant.userId)
      throw new AppError('not_found', '找不到媒体');
    if (isBuiltinKey(row.storageKey)) {
      const body = renderBuiltinSvg(row.storageKey);
      if (!body) throw new AppError('not_found', '找不到媒体');
      const want = builtinFormat(accept);
      if (want === 'webp')
        return { body: await sharp(body).webp().toBuffer(), mimeType: 'image/webp' };
      if (want === 'png')
        return { body: await sharp(body).png().toBuffer(), mimeType: 'image/png' };
      return { body, mimeType: row.mimeType };
    }
    const thumb = grant.v === 't' && row.thumbStorageKey;
    try {
      const cipher = await this.storage.get(thumb ? row.thumbStorageKey! : row.storageKey);
      return {
        body: await this.crypto.open(
          row.ownerId ?? PLATFORM_KEY_OWNER,
          thumb ? `media-thumb:${row.id}` : `media:${row.id}`,
          cipher,
        ),
        mimeType: thumb ? 'image/webp' : row.mimeType,
      };
    } catch {
      throw new AppError('not_found', '找不到媒体');
    }
  }

  // ---------- MediaSystemPort ----------

  async canUse(userId: string, mediaId: string, allowedPurposes: MediaPurpose[]): Promise<boolean> {
    const row = await this.findReady(mediaId);
    if (!row || !allowedPurposes.includes(row.purpose as MediaPurpose)) return false;
    return row.ownerId === userId || (row.ownerId === null && LIBRARY_PURPOSES.has(row.purpose));
  }

  /** 内置素材转 PNG（模型和复制品统一用位图，避免下游不认 SVG）。 */
  private async builtinPng(storageKey: string): Promise<Buffer> {
    const svg = renderBuiltinSvg(storageKey);
    if (!svg) throw new AppError('not_found', '找不到媒体');
    return sharp(svg).png().toBuffer();
  }

  async readBytes(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const row = await this.get(mediaId);
    if (isBuiltinKey(row.storageKey))
      return { bytes: await this.builtinPng(row.storageKey), mimeType: 'image/png' };
    const cipher = await this.storage.get(row.storageKey);
    const bytes = await this.crypto.open(
      row.ownerId ?? PLATFORM_KEY_OWNER,
      `media:${row.id}`,
      cipher,
    );
    return { bytes, mimeType: row.mimeType };
  }

  async putObject(input: {
    ownerUserId: string | null;
    purpose: MediaPurpose;
    bytes: Uint8Array;
    mimeType: string;
    durationMs?: number;
  }): Promise<MediaObject> {
    const buffer = Buffer.from(input.bytes);
    const processed = isAudioPurpose(input.purpose)
      ? this.processAudio(
          input.purpose === 'chat_voice' ? 'generated_voice' : input.purpose,
          {
            buffer,
            mimetype: input.mimeType,
          },
          input.durationMs ?? null,
        )
      : await this.processImage(buffer, input.mimeType);
    const row = await this.store({
      ownerId: input.ownerUserId,
      purpose: input.purpose,
      processed,
      transcriptStatus: null,
    });
    return this.toMedia(row, input.ownerUserId ?? PLATFORM_KEY_OWNER);
  }

  async copyObject(input: {
    mediaId: string;
    ownerUserId: string | null;
    purpose: MediaPurpose;
  }): Promise<MediaObject> {
    const row = await this.copyRow(input.mediaId, input.ownerUserId, input.purpose);
    return this.toMedia(row, input.ownerUserId ?? PLATFORM_KEY_OWNER);
  }

  /** 复制对象（重新加密到新所有者），保留宽高、时长、缩略图与内容摘要。 */
  async copyRow(mediaId: string, ownerId: string | null, purpose: string): Promise<Row> {
    const source = await this.get(mediaId);
    if (isBuiltinKey(source.storageKey))
      return this.store({
        ownerId,
        purpose,
        processed: {
          body: await this.builtinPng(source.storageKey),
          mimeType: 'image/png',
          width: source.width,
          height: source.height,
          thumb: null,
          durationMs: null,
        },
        transcriptStatus: null,
      });
    const sourceOwner = source.ownerId ?? PLATFORM_KEY_OWNER;
    const body = await this.crypto.open(
      sourceOwner,
      `media:${source.id}`,
      await this.storage.get(source.storageKey),
    );
    const thumb = source.thumbStorageKey
      ? await this.crypto.open(
          sourceOwner,
          `media-thumb:${source.id}`,
          await this.storage.get(source.thumbStorageKey),
        )
      : null;
    return this.store({
      ownerId: ownerId,
      purpose,
      processed: {
        body,
        mimeType: source.mimeType,
        width: source.width,
        height: source.height,
        thumb,
        durationMs: source.durationMs,
      },
      transcriptStatus: null,
    });
  }

  async deleteObject(mediaId: string, tx?: Tx): Promise<void> {
    const db = tx ? asDbTx(tx).db : this.database.db;
    const [row] = await db
      .update(objects)
      .set({ state: 'deleting' })
      .where(eq(objects.id, mediaId))
      .returning();
    if (!row) return;
    const remove = async () => {
      try {
        if (!isBuiltinKey(row.storageKey)) await this.storage.delete(row.storageKey);
        if (row.thumbStorageKey) await this.storage.delete(row.thumbStorageKey);
        await this.database.db.delete(objects).where(eq(objects.id, row.id));
      } catch {
        // 留给生命周期任务重试。
      }
    };
    if (tx) asDbTx(tx).afterCommit(remove);
    else await remove();
  }

  // ---------- 语音转文字（MediaTranscriptPort） ----------

  async setTranscript(input: {
    mediaId: string;
    status: 'ready' | 'failed' | 'unavailable';
    text: string | null;
  }): Promise<void> {
    const row = await this.findReady(input.mediaId);
    if (!row) return;
    const text = input.status === 'ready' ? (input.text ?? '').slice(0, 4000) : null;
    await this.database.transaction(async (tx) => {
      const cipher =
        text !== null
          ? await this.crypto.seal(
              row.ownerId ?? PLATFORM_KEY_OWNER,
              `media-transcript:${row.id}`,
              text,
              tx,
            )
          : null;
      await tx.db
        .update(objects)
        .set({ transcriptStatus: input.status, transcriptCiphertext: cipher })
        .where(eq(objects.id, row.id));
      if (row.ownerId && this.sync)
        await this.sync.appendUpdate(tx, row.ownerId, {
          type: 'media.transcript_ready',
          data: { transcript: { mediaId: row.id, status: input.status, text } },
        });
    });
  }

  async getTranscript(
    mediaId: string,
  ): Promise<{ status: 'pending' | 'ready' | 'failed' | 'unavailable'; text: string | null }> {
    const row = await this.findReady(mediaId);
    if (!row || !row.mimeType.startsWith('audio/')) return { status: 'unavailable', text: null };
    return this.readTranscript(row);
  }

  async getTranscriptForUser(userId: string, mediaId: string): Promise<MediaTranscript> {
    const row = await this.get(mediaId);
    if (row.ownerId !== null && row.ownerId !== userId)
      throw new AppError('not_found', '找不到媒体');
    if (!row.mimeType.startsWith('audio/')) return { mediaId, status: 'unavailable', text: null };
    return { mediaId, ...(await this.readTranscript(row)) };
  }

  private async readTranscript(
    row: Row,
  ): Promise<{ status: 'pending' | 'ready' | 'failed' | 'unavailable'; text: string | null }> {
    const status = (row.transcriptStatus ?? 'pending') as
      'pending' | 'ready' | 'failed' | 'unavailable';
    if (status !== 'ready' || !row.transcriptCiphertext) return { status, text: null };
    const plain = await this.crypto.open(
      row.ownerId ?? PLATFORM_KEY_OWNER,
      `media-transcript:${row.id}`,
      row.transcriptCiphertext,
    );
    return { status, text: plain.toString('utf8') };
  }

  // ---------- 注销 ----------

  async purgeUser(userId: string): Promise<number> {
    const packs = await this.database.db
      .delete(userStickerPacks)
      .where(eq(userStickerPacks.userId, userId))
      .returning();
    const stickers = await this.database.db
      .delete(userStickers)
      .where(eq(userStickers.userId, userId))
      .returning({ id: userStickers.id });
    const rows = await this.database.db.select().from(objects).where(eq(objects.ownerId, userId));
    // 先删对象再删元数据；存储失败抛出，保留记录供注销重试，不能静默丢失清理位置。
    for (const row of rows) await this.removeRow(row);
    return rows.length + stickers.length + packs.length;
  }
  async countUserData(userId: string): Promise<number> {
    const [a] = await this.database.db
      .select({ n: count() })
      .from(objects)
      .where(eq(objects.ownerId, userId));
    const [b] = await this.database.db
      .select({ n: count() })
      .from(userStickers)
      .where(eq(userStickers.userId, userId));
    const [c] = await this.database.db
      .select({ n: count() })
      .from(userStickerPacks)
      .where(eq(userStickerPacks.userId, userId));
    return (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0);
  }

  /** 注销核验（MediaStorageAudit）：存储里没有元数据行对应的文件。 */
  async findOrphanKeys(limit = 50): ReturnType<MediaStorageAudit['findOrphanKeys']> {
    if (!this.storage.list) return { listed: false, total: 0, orphans: [] };
    const orphans: string[] = [];
    let total = 0;
    let batch: string[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const keys = batch.map((k) => k.replace(/.pending$/, ''));
      const rows = await this.database.db
        .select({ a: objects.storageKey, b: objects.thumbStorageKey })
        .from(objects)
        .where(or(inArray(objects.storageKey, keys), inArray(objects.thumbStorageKey, keys)));
      const known = new Set(rows.flatMap((r) => [r.a, r.b]).filter(Boolean));
      for (const k of keys) if (!known.has(k) && orphans.length < limit) orphans.push(k);
      batch = [];
    };
    for await (const key of this.storage.list()) {
      total += 1;
      batch.push(key);
      if (batch.length >= 500) await flush();
    }
    await flush();
    return { listed: true, total, orphans };
  }

  /** 内部：批量读元数据（素材库列表用）。 */
  async findReadyMany(ids: string[]): Promise<Map<string, Row>> {
    if (!ids.length) return new Map();
    const rows = await this.database.db
      .select()
      .from(objects)
      .where(and(inArray(objects.id, ids), eq(objects.state, 'ready')));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** 内部：在调用方事务中追加同步更新（未装配同步时忽略）。 */
  async appendUpdate(tx: DbTx, userId: string, update: Parameters<MediaSync['appendUpdate']>[2]) {
    if (this.sync) await this.sync.appendUpdate(tx, userId, update);
  }
}

/** 内置素材按 Accept 选格式：接受 SVG（或没写 Accept）给 SVG，否则优先 WebP、其次 PNG。 */
function builtinFormat(accept: string | undefined): 'svg' | 'webp' | 'png' {
  const a = (accept ?? '').toLowerCase();
  if (!a || a.includes('image/svg+xml')) return 'svg';
  if (a.includes('image/webp')) return 'webp';
  if (a.includes('image/png')) return 'png';
  return 'svg';
}
