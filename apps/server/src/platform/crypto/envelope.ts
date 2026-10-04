/**
 * 信封加密（security-and-privacy.md 第 3 节，ADR-0006）。任何模块不得自己写加密代码，一律用这里。
 *
 *   主密钥 KEK（服务器机密文件，PLATFORM_KEK_FILE；不进数据库、不进备份、不进仓库）
 *     └─加密→ 数据密钥 DEK（platform.user_data_keys，只存密文 + kek_version；平台一把 owner='platform'，每用户一把）
 *         └─加密→ 业务数据（上游密钥、导入原文……）
 *
 * 用法：
 *   const sealed = await crypto.seal(PLATFORM_KEY_OWNER, `upstream:${upstreamId}`, apiKey, tx); // Buffer，存 bytea
 *   const apiKey = (await crypto.open(PLATFORM_KEY_OWNER, `upstream:${upstreamId}`, sealed)).toString('utf8');
 *
 * - 算法 AES-256-GCM，每次加密独立随机 nonce；能发现篡改。
 * - AAD（附加认证数据）把密文绑定到「哪个 owner + 哪一行」：密文挪到别的行或别的用户名下就解不开。
 * - 解密结果只在内存里用完即弃，不要缓存、不要写日志。
 * - destroyKey(userId)：删除某用户的 DEK，其加密数据随即永久不可解（注销时使用）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Clock } from '../clock/clock.js';
import type { Database, DbTx, QueryResult } from '../db/database.js';

export const ENVELOPE_CRYPTO = Symbol('weiban.platform.envelope-crypto');

/** 平台数据密钥的 owner（用于上游密钥，billing.md 第 3 节）。 */
export const PLATFORM_KEY_OWNER = 'platform';

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CryptoUnavailableError extends Error {
  constructor() {
    super('未配置主密钥（PLATFORM_KEK_FILE），加密功能不可用');
    this.name = 'CryptoUnavailableError';
  }
}

export class DecryptionError extends Error {
  constructor(reason: string) {
    super(`解密失败：${reason}`);
    this.name = 'DecryptionError';
  }
}

/** 主密钥集合：当前版本用于新加密；旧版本只用于解开轮换前包装的 DEK。 */
export interface KekRing {
  currentVersion: number;
  keys: ReadonlyMap<number, Buffer>;
}

/** AES-256-GCM 加密，输出：版本(1) | nonce(12) | tag(16) | 密文。 */
export function aesGcmSeal(key: Buffer, aad: string, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), body]);
}

export function aesGcmOpen(key: Buffer, aad: string, sealed: Buffer): Buffer {
  if (sealed.length < 1 + NONCE_BYTES + TAG_BYTES || sealed[0] !== FORMAT_VERSION) {
    throw new DecryptionError('密文格式不对');
  }
  const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
  const tag = sealed.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const body = sealed.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new DecryptionError('密钥、AAD 不匹配或数据被篡改');
  }
}

type Executor = Pick<DbTx, 'query'>;

export class EnvelopeCrypto {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly ring: KekRing | null,
  ) {
    if (ring) {
      for (const [version, key] of ring.keys) {
        if (key.length !== KEY_BYTES) throw new Error(`主密钥 v${version} 必须是 32 字节`);
      }
      if (!ring.keys.has(ring.currentVersion)) throw new Error('主密钥集合里没有当前版本');
    }
  }

  /** 是否已配置主密钥（健康检查用）。 */
  isAvailable(): boolean {
    return this.ring !== null;
  }

  async seal(owner: string, aad: string, plaintext: string | Buffer, tx?: DbTx): Promise<Buffer> {
    const dek = await this.getOrCreateDek(owner, tx ?? this.database);
    try {
      const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
      return aesGcmSeal(dek, dataAad(owner, aad), data);
    } finally {
      dek.fill(0);
    }
  }

  async open(owner: string, aad: string, sealed: Buffer, tx?: DbTx): Promise<Buffer> {
    const dek = await this.loadDek(owner, tx ?? this.database);
    if (!dek) throw new DecryptionError(`owner ${owner} 没有数据密钥（可能已注销删除）`);
    try {
      return aesGcmOpen(dek, dataAad(owner, aad), sealed);
    } finally {
      dek.fill(0);
    }
  }

  /** 删除 owner 的数据密钥：用它加密的数据从此无法解密。可重复调用。 */
  async destroyKey(owner: string, tx?: DbTx): Promise<void> {
    assertOwner(owner);
    await (tx ?? this.database).query('DELETE FROM platform.user_data_keys WHERE owner = $1', [
      owner,
    ]);
  }

  private requireRing(): KekRing {
    if (!this.ring) throw new CryptoUnavailableError();
    return this.ring;
  }

  private async loadDek(owner: string, db: Executor): Promise<Buffer | null> {
    assertOwner(owner);
    const ring = this.requireRing();
    const { rows } = (await db.query(
      'SELECT wrapped_dek, kek_version FROM platform.user_data_keys WHERE owner = $1',
      [owner],
    )) as QueryResult<{ wrapped_dek: Buffer; kek_version: number }>;
    const row = rows[0];
    if (!row) return null;
    const kek = ring.keys.get(row.kek_version);
    if (!kek) throw new DecryptionError(`缺少主密钥 v${row.kek_version}`);
    return aesGcmOpen(kek, dekAad(owner, row.kek_version), row.wrapped_dek);
  }

  private async getOrCreateDek(owner: string, db: Executor): Promise<Buffer> {
    const existing = await this.loadDek(owner, db);
    if (existing) return existing;
    const ring = this.requireRing();
    const dek = randomBytes(KEY_BYTES);
    const kek = ring.keys.get(ring.currentVersion) as Buffer;
    const wrapped = aesGcmSeal(kek, dekAad(owner, ring.currentVersion), dek);
    const inserted = await db.query(
      `INSERT INTO platform.user_data_keys (owner, wrapped_dek, kek_version, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (owner) DO NOTHING RETURNING owner`,
      [owner, wrapped, ring.currentVersion, this.clock.now()],
    );
    if (inserted.rowCount === 1) return dek;
    // 并发时别人先建好了：用已存在的那把
    dek.fill(0);
    const winner = await this.loadDek(owner, db);
    if (!winner) throw new Error('数据密钥创建冲突后仍读不到');
    return winner;
  }
}

function assertOwner(owner: string): void {
  if (owner !== PLATFORM_KEY_OWNER && !UUID.test(owner)) {
    throw new Error(`数据密钥 owner 只能是 '${PLATFORM_KEY_OWNER}' 或用户 ID`);
  }
}

function dekAad(owner: string, kekVersion: number): string {
  return `weiban:dek:${owner}:v${kekVersion}`;
}

function dataAad(owner: string, aad: string): string {
  return `weiban:data:${owner}:${aad}`;
}
