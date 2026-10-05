import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import sharp from 'sharp';
import { and, count, eq, lt } from 'drizzle-orm';
import {
  MEDIA_LIMITS,
  type MediaObject,
  type MediaPurpose,
  type UserDataOwner,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  AUDIT_LOG,
  CLOCK,
  JOB_QUEUE,
  DATABASE,
  ENVELOPE_CRYPTO,
  PLATFORM_KEY_OWNER,
  USER_DATA_REGISTRY,
  AppError,
  newId,
  type AppConfig,
  type AuditLog,
  type Clock,
  type JobQueue,
  type Database,
  type EnvelopeCrypto,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { objects } from '../infra/db/schema.js';
import { MEDIA_STORAGE } from '../tokens.js';
import type { ObjectStorage } from '../infra/storage.js';
type Row = typeof objects.$inferSelect;
export interface MediaReadPort {
  getMedia(userId: string, mediaId: string): Promise<MediaObject>;
}
@Injectable()
export class MediaService implements UserDataOwner, OnModuleInit, MediaReadPort {
  readonly module = 'media';
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(MEDIA_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    await this.jobs.work('media.recover_uploads', () => this.recoverUploads());
    await this.jobs.schedule('media.recover_uploads', '*/10 * * * *');
  }
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
    for (const row of pending) {
      await this.storage.delete(row.storageKey);
      await this.database.db.delete(objects).where(eq(objects.id, row.id));
    }
  }
  async upload(
    userId: string,
    purpose: MediaPurpose,
    file: { buffer: Buffer; mimetype: string },
    admin = false,
  ): Promise<MediaObject> {
    if (purpose === 'character_avatar' && !admin)
      throw new AppError('forbidden', '此用途需要管理员权限');
    if (
      !file?.buffer?.length ||
      file.buffer.length > MEDIA_LIMITS.imageMaxBytes ||
      !(MEDIA_LIMITS.imageMimeTypes as readonly string[]).includes(file.mimetype)
    )
      throw new AppError('bad_request', '图片格式或大小不符合要求');
    let body: Buffer;
    let width: number;
    let height: number;
    try {
      const image = sharp(file.buffer, {
        animated: true,
        limitInputPixels: 40000000,
        failOn: 'error',
      });
      const meta = await image.metadata();
      const mime = (
        { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' } as Record<
          string,
          string
        >
      )[meta.format ?? ''];
      if (
        !mime ||
        mime !== file.mimetype ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > 40000000
      )
        throw new Error('unsupported image');
      // 解码后重编码，去掉EXIF/GPS、尾部附加数据，统一WebP；不接受SVG或客户端声称的假图片。
      const encoded = await image
        .rotate()
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      body = encoded.data;
      width = encoded.info.width;
      height = encoded.info.height;
      if (body.length > MEDIA_LIMITS.imageMaxBytes) throw new Error('image too large');
    } catch {
      throw new AppError('bad_request', '图片无法解码或像素过大');
    }
    const id = newId();
    const storageKey = `${id}.sealed`;
    const ownerId = purpose === 'character_avatar' ? null : userId;
    const ciphertext = await this.crypto.seal(ownerId ?? PLATFORM_KEY_OWNER, `media:${id}`, body);
    const [row] = await this.database.db
      .insert(objects)
      .values({
        id,
        ownerId,
        purpose,
        mimeType: 'image/webp',
        sizeBytes: body.length,
        width,
        height,
        storageKey,
        state: 'pending',
        createdAt: this.clock.now(),
      })
      .returning();
    if (!row) throw new Error('媒体元数据写入失败');
    try {
      await this.storage.put(storageKey, ciphertext);
      const [ready] = await this.database.db
        .update(objects)
        .set({ state: 'ready' })
        .where(eq(objects.id, id))
        .returning();
      if (!ready) {
        await this.storage.delete(storageKey);
        throw new AppError('not_found', '媒体已删除');
      }
      if (admin)
        await this.audit.record({
          module: 'media',
          action: 'avatar.uploaded',
          actorType: 'admin',
          actorId: userId,
          targetType: 'media',
          targetId: id,
          details: { purpose, mimeType: ready.mimeType, sizeBytes: ready.sizeBytes },
        });
      return this.toMedia(ready, userId);
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      await this.database.db.delete(objects).where(eq(objects.id, id));
      if (error instanceof AppError) throw error;
      throw new AppError('service_unavailable', '媒体存储暂时不可用');
    } finally {
      body.fill(0);
    }
  }
  async getMedia(userId: string, mediaId: string): Promise<MediaObject> {
    const row = await this.get(mediaId);
    if (row.ownerId !== null && row.ownerId !== userId)
      throw new AppError('not_found', '找不到媒体');
    return this.toMedia(row, userId);
  }
  private async get(id: string): Promise<Row> {
    const [row] = await this.database.db
      .select()
      .from(objects)
      .where(and(eq(objects.id, id), eq(objects.state, 'ready')));
    if (!row) throw new AppError('not_found', '找不到媒体');
    return row;
  }
  private async toMedia(row: Row, userId: string): Promise<MediaObject> {
    const expires = new Date(this.clock.nowMs() + 5 * 60 * 1000);
    const token = (
      await this.crypto.seal(
        PLATFORM_KEY_OWNER,
        `media-link:${row.id}`,
        JSON.stringify({ userId, expiresAt: expires.getTime() }),
      )
    ).toString('base64url');
    const url = new URL(`/api/v1/media/${row.id}/content`, this.config.media.publicBaseUrl);
    url.searchParams.set('token', token);
    return {
      mediaId: row.id,
      purpose: row.purpose as MediaPurpose,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      url: url.toString(),
      urlExpiresAt: expires.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
  async download(mediaId: string, token: string): Promise<{ body: Buffer; mimeType: string }> {
    if (!token || token.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(token))
      throw new AppError('forbidden', '访问链接无效');
    let grant: { userId: string; expiresAt: number };
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
    try {
      const cipher = await this.storage.get(row.storageKey);
      return {
        body: await this.crypto.open(row.ownerId ?? PLATFORM_KEY_OWNER, `media:${row.id}`, cipher),
        mimeType: row.mimeType,
      };
    } catch {
      throw new AppError('not_found', '找不到媒体');
    }
  }
  async purgeUser(userId: string): Promise<number> {
    const rows = await this.database.db.select().from(objects).where(eq(objects.ownerId, userId));
    // 先删对象再删元数据；存储失败保留记录供注销重试，不能静默丢失清理位置。
    for (const row of rows) {
      await this.storage.delete(row.storageKey);
      await this.database.db.delete(objects).where(eq(objects.id, row.id));
    }
    return rows.length;
  }
  async countUserData(userId: string): Promise<number> {
    const [row] = await this.database.db
      .select({ n: count() })
      .from(objects)
      .where(eq(objects.ownerId, userId));
    return row?.n ?? 0;
  }
}
