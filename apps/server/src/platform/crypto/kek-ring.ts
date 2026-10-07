/** 读取版本化密钥文件集合；文件仅存路径，实际32字节密钥仍分别放秘密文件。 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ConfigError, readKekFile, type AppConfig } from '../config/config.js';
import type { KekRing } from './envelope.js';
const RingFile = z.strictObject({
  currentVersion: z.number().int().min(1).max(2_147_483_647),
  files: z.record(z.string().regex(/^[1-9]\d*$/), z.string().min(1)),
});
export function loadKekRing(config: AppConfig): KekRing | null {
  if (!config.crypto.kekRingFile)
    return config.crypto.kekFile
      ? {
          currentVersion: config.crypto.kekVersion,
          keys: new Map([[config.crypto.kekVersion, readKekFile(config.crypto.kekFile)]]),
        }
      : null;
  let input: z.infer<typeof RingFile>;
  try {
    input = RingFile.parse(JSON.parse(readFileSync(config.crypto.kekRingFile, 'utf8')));
  } catch {
    throw new ConfigError([
      'PLATFORM_KEK_RING_FILE：必须为currentVersion和files版本→秘密文件路径对象',
    ]);
  }
  const keys = new Map<number, Buffer>();
  try {
    for (const [version, path] of Object.entries(input.files)) {
      const n = Number(version);
      if (!Number.isSafeInteger(n) || n > input.currentVersion)
        throw new ConfigError(['PLATFORM_KEK_RING_FILE：旧版本必须小于当前版本']);
      const key = readKekFile(path);
      if ([...keys.values()].some((existing) => existing.equals(key))) {
        key.fill(0);
        throw new ConfigError(['PLATFORM_KEK_RING_FILE：不同版本必须使用不同密钥']);
      }
      keys.set(n, key);
    }
    if (!keys.has(input.currentVersion))
      throw new ConfigError(['PLATFORM_KEK_RING_FILE：缺少当前版本秘密文件']);
    return { currentVersion: input.currentVersion, keys };
  } catch (error) {
    for (const key of keys.values()) key.fill(0);
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(['PLATFORM_KEK_RING_FILE：秘密文件不可读取']);
  }
}
