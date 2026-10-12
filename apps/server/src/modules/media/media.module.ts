import { Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { S3Client } from '@aws-sdk/client-s3';
import { APP_CONFIG, ConfigError, type AppConfig } from '../../platform/index.js';
import { MediaService } from './application/media.js';
import { MediaAssetService } from './application/assets.js';
import { LinkPreviewService } from './application/link-preview.js';
import { DiskStorage, S3Storage } from './infra/storage.js';
import {
  MediaController,
  MediaAdminController,
  LinkPreviewController,
} from './http/media.controller.js';
import { StickerController, AssetAdminController } from './http/assets.controller.js';
import {
  MEDIA_STORAGE,
  MEDIA_READ_PORT,
  MEDIA_SYSTEM_PORT,
  MEDIA_TRANSCRIPT_PORT,
  MEDIA_ASSET_READ_PORT,
  LINK_PREVIEW_PORT,
  MEDIA_STICKER_CHECK,
  MEDIA_STORAGE_AUDIT,
  MEDIA_CLASSICAL_CARD_TEMPLATES,
} from './tokens.js';
@Module({
  controllers: [
    MediaController,
    MediaAdminController,
    LinkPreviewController,
    StickerController,
    AssetAdminController,
  ],
  providers: [
    MediaService,
    MediaAssetService,
    LinkPreviewService,
    { provide: MEDIA_READ_PORT, useExisting: MediaService },
    { provide: MEDIA_SYSTEM_PORT, useExisting: MediaService },
    { provide: MEDIA_TRANSCRIPT_PORT, useExisting: MediaService },
    { provide: MEDIA_ASSET_READ_PORT, useExisting: MediaAssetService },
    { provide: MEDIA_STICKER_CHECK, useExisting: MediaAssetService },
    { provide: MEDIA_CLASSICAL_CARD_TEMPLATES, useExisting: MediaAssetService },
    { provide: LINK_PREVIEW_PORT, useExisting: LinkPreviewService },
    { provide: MEDIA_STORAGE_AUDIT, useExisting: MediaService },
    {
      provide: MEDIA_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.media.driver === 'disk') return new DiskStorage(config.media.diskRoot);
        let credentials: { accessKeyId: string; secretAccessKey: string };
        try {
          credentials = z
            .object({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) })
            .parse(JSON.parse(readFileSync(config.media.s3CredentialsFile!, 'utf8')));
        } catch {
          throw new ConfigError(['MEDIA_S3_CREDENTIALS_FILE：凭据文件无法读取或格式不正确']);
        }
        return new S3Storage(
          new S3Client({
            region: config.media.s3Region,
            endpoint: config.media.s3Endpoint ?? undefined,
            forcePathStyle: config.media.s3ForcePathStyle,
            credentials,
            maxAttempts: 3,
          }),
          config.media.s3Bucket!,
        );
      },
    },
  ],
  exports: [
    MEDIA_READ_PORT,
    MEDIA_SYSTEM_PORT,
    MEDIA_TRANSCRIPT_PORT,
    MEDIA_ASSET_READ_PORT,
    MEDIA_STICKER_CHECK,
    MEDIA_CLASSICAL_CARD_TEMPLATES,
    LINK_PREVIEW_PORT,
    MEDIA_STORAGE_AUDIT,
  ],
})
export class MediaModule {}
