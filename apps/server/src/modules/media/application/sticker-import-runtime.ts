/** Minimal maintenance composition: never bootstrap Nest, initialize modules or start jobs. */
import { readFileSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  JobQueue,
  UserDataRegistry,
  createLogger,
  type AppConfig,
  type AuditLog,
  type Clock,
  type Database,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { DiskStorage, S3Storage, type ObjectStorage } from '../infra/storage.js';
import { MediaService } from './media.js';
import { MediaAssetService } from './assets.js';
import { StickerAssetImporter, StickerImportError } from './sticker-asset-importer.js';

export function createStickerAssetImporter(input: {
  database: Database;
  config: AppConfig;
  clock: Clock;
  crypto: EnvelopeCrypto;
  audit: AuditLog;
  apply: boolean;
  activeAdmin: (id: string) => Promise<boolean>;
}): StickerAssetImporter {
  const { database, config, clock, crypto, audit } = input;
  const unavailable = async (): Promise<never> => {
    throw new StickerImportError('PREVIEW_STORAGE_ACCESS_REJECTED');
  };
  let storage: ObjectStorage = { put: unavailable, get: unavailable, delete: unavailable };
  if (input.apply) {
    if (config.media.driver === 'disk') storage = new DiskStorage(config.media.diskRoot);
    else {
      let credentials: { accessKeyId: string; secretAccessKey: string };
      try {
        credentials = z
          .object({ accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1) })
          .parse(JSON.parse(readFileSync(config.media.s3CredentialsFile!, 'utf8')));
      } catch {
        throw new StickerImportError('STORAGE_CONFIGURATION_INVALID');
      }
      storage = new S3Storage(
        new S3Client({
          region: config.media.s3Region,
          endpoint: config.media.s3Endpoint ?? undefined,
          forcePathStyle: config.media.s3ForcePathStyle,
          credentials,
          maxAttempts: 1,
        }),
        config.media.s3Bucket!,
      );
    }
  }
  // Merely constructed, never started: no worker registration, scheduling or pg-boss writes.
  const jobs = new JobQueue({
    databaseUrl: config.database.url,
    clock,
    logger: createLogger({ level: 'silent' }),
    consume: false,
  });
  const media = new MediaService(
    database,
    clock,
    crypto,
    storage,
    config,
    audit,
    new UserDataRegistry(),
    jobs,
    {
      getAccountStatus: async () => {
        throw new StickerImportError('PRIVATE_MEDIA_IMPORT_REJECTED');
      },
    },
  );
  return new StickerAssetImporter(
    database,
    media,
    new MediaAssetService(database, clock, audit, media),
    input.activeAdmin,
  );
}
