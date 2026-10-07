import { Module } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { S3Client } from '@aws-sdk/client-s3';
import { APP_CONFIG, ConfigError, type AppConfig } from '../../platform/index.js';
import { MediaService } from './application/media.js';
import { DiskStorage, S3Storage } from './infra/storage.js';
import { MediaController, MediaAdminController } from './http/media.controller.js';
import { MEDIA_STORAGE, MEDIA_READ_PORT } from './tokens.js';
@Module({
  controllers: [MediaController, MediaAdminController],
  providers: [
    MediaService,
    { provide: MEDIA_READ_PORT, useExisting: MediaService },
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
  exports: [MEDIA_READ_PORT],
})
export class MediaModule {}
