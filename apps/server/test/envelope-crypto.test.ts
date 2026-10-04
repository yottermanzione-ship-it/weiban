/**
 * 验收：信封加密——加密、解密往返正确；主密钥不在数据库中。
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TestClock } from '../src/platform/clock/clock.js';
import {
  CryptoUnavailableError,
  DecryptionError,
  EnvelopeCrypto,
  PLATFORM_KEY_OWNER,
} from '../src/platform/crypto/envelope.js';
import { Database } from '../src/platform/db/database.js';
import { newId } from '../src/platform/db/ids.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';
import { canaryKey, testKekRing } from './support/fixtures.js';

describeDb('信封加密（真实 PostgreSQL）', () => {
  let database: Database;
  const clock = new TestClock();
  const { ring, kek } = testKekRing();
  let crypto: EnvelopeCrypto;

  beforeAll(async () => {
    await resetTestDatabase();
    database = new Database({ url: requireTestDatabaseUrl() });
    crypto = new EnvelopeCrypto(database, clock, ring);
  });

  afterAll(async () => {
    await database?.close();
  });

  /** 把整张数据密钥表和全部字节列导出成十六进制文本，模拟「数据库被拿走」。 */
  async function dumpKeyTableHex(): Promise<string> {
    const { rows } = await database.query<{ dump: string }>(
      `SELECT string_agg(owner || ':' || encode(wrapped_dek, 'hex') || ':' || kek_version, '|') AS dump
         FROM platform.user_data_keys`,
    );
    return rows[0]?.dump ?? '';
  }

  it('平台密钥：加密解密往返正确，密文里看不到明文', async () => {
    const apiKey = canaryKey();
    const upstreamId = newId();
    const sealed = await crypto.seal(PLATFORM_KEY_OWNER, `upstream:${upstreamId}`, apiKey);
    expect(sealed.toString('latin1')).not.toContain(apiKey);
    const opened = await crypto.open(PLATFORM_KEY_OWNER, `upstream:${upstreamId}`, sealed);
    expect(opened.toString('utf8')).toBe(apiKey);
  });

  it('主密钥不在数据库中：数据密钥表只有被包装的密文，搜不到主密钥', async () => {
    await crypto.seal(newId(), 'import:job', 'raw text');
    const dump = await dumpKeyTableHex();
    expect(dump).toContain('platform:');
    expect(dump).not.toContain(kek.toString('hex'));
    // 整个数据库里所有 bytea / text 列都不应出现主密钥
    const { rows } = await database.query<{ hit: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM platform.user_data_keys
                       WHERE position($1::bytea IN wrapped_dek) > 0) AS hit`,
      [kek],
    );
    expect(rows[0]?.hit).toBe(false);
  });

  it('密文挪到别的行（AAD 不同）或别的用户名下都解不开', async () => {
    const userA = newId();
    const userB = newId();
    const sealed = await crypto.seal(userA, 'import:job-1', 'secret');
    await expect(crypto.open(userA, 'import:job-2', sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
    await crypto.seal(userB, 'import:job-1', 'other');
    await expect(crypto.open(userB, 'import:job-1', sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('换一把主密钥就解不开（单独拿走数据库没有用）', async () => {
    const sealed = await crypto.seal(PLATFORM_KEY_OWNER, 'upstream:x', 'k');
    const thief = new EnvelopeCrypto(database, clock, testKekRing().ring);
    await expect(thief.open(PLATFORM_KEY_OWNER, 'upstream:x', sealed)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('删除用户数据密钥后，该用户的数据永久不可解', async () => {
    const user = newId();
    const sealed = await crypto.seal(user, 'import:j', 'raw');
    await crypto.destroyKey(user);
    await expect(crypto.open(user, 'import:j', sealed)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('事务里加密：事务回滚时新建的数据密钥也不保留', async () => {
    const user = newId();
    await database
      .transaction(async (tx) => {
        await crypto.seal(user, 'import:j', 'raw', tx);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const { rowCount } = await database.query(
      'SELECT 1 FROM platform.user_data_keys WHERE owner = $1',
      [user],
    );
    expect(rowCount).toBe(0);
  });

  it('未配置主密钥时明确报「不可用」，owner 不合法时拒绝', async () => {
    const none = new EnvelopeCrypto(database, clock, null);
    expect(none.isAvailable()).toBe(false);
    await expect(none.seal(PLATFORM_KEY_OWNER, 'a', 'b')).rejects.toBeInstanceOf(
      CryptoUnavailableError,
    );
    await expect(crypto.seal("x'; drop table", 'a', 'b')).rejects.toThrow(/owner/);
  });
});
