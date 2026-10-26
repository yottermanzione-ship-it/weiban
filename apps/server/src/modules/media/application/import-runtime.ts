/** 维护 CLI 的最小媒体装配：不启动 Nest、不注册 worker，只在 --apply 时打开真实存储。 */
import { readFileSync } from 'node:fs';
import { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import {
  CharacterPurgeRegistry,
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
import type { MediaAccountStatus } from '../tokens.js';

export function createImportMediaService(input: {
  database: Database;
  config: AppConfig;
  clock: Clock;
  crypto: EnvelopeCrypto;
  audit: AuditLog;
  apply: boolean;
  /** Private content migration must provide the real identity status/locking port. */
  accountStatus?: MediaAccountStatus;
}): MediaService {
  const { database, config, clock, crypto, audit } = input;
  const unavailable = async (): Promise<never> => {
    throw new Error('PREVIEW_STORAGE_ACCESS_REJECTED');
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
        throw new Error('STORAGE_CONFIGURATION_INVALID');
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
  // 只构造、不启动：不会写 pg-boss，也不会在维护脚本里调度任务。
  const jobs = new JobQueue({
    databaseUrl: config.database.url,
    clock,
    logger: createLogger({ level: 'silent' }),
    consume: false,
  });
  return new MediaService(
    database,
    clock,
    crypto,
    storage,
    config,
    audit,
    new UserDataRegistry(),
    // 维护脚本不参与后台彻底删除；登记表为空只为满足构造签名。
    new CharacterPurgeRegistry(),
    jobs,
    input.accountStatus ?? {
      getAccountStatus: async () => {
        throw new Error('PRIVATE_MEDIA_IMPORT_REJECTED');
      },
    },
  );
}
