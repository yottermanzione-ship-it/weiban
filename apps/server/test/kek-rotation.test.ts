import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { Database } from '../src/platform/db/database.js';
import { EnvelopeCrypto, DecryptionError, type KekRing } from '../src/platform/crypto/envelope.js';
import { TestClock } from '../src/platform/clock/clock.js';
import { newId } from '../src/platform/db/ids.js';
import { describeDb, resetTestDatabase, requireTestDatabaseUrl } from './support/db.js';
describeDb('主密钥轮换：真实事务与恢复', () => {
  let db: Database;
  const oldKey = randomBytes(32),
    newKey = randomBytes(32);
  const oldRing: KekRing = { currentVersion: 1, keys: new Map([[1, oldKey]]) };
  const ring: KekRing = {
    currentVersion: 2,
    keys: new Map([
      [1, oldKey],
      [2, newKey],
    ]),
  };
  const clock = new TestClock();
  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl() });
  });
  beforeEach(async () => {
    await db.query('DELETE FROM platform.user_data_keys');
  });
  afterAll(async () => {
    await db?.close();
  });
  async function sample() {
    const old = new EnvelopeCrypto(db, clock, oldRing);
    const owners = ['platform', newId(), newId(), newId()];
    const sealed = await Promise.all(
      owners.map((owner) =>
        old.seal(owner, 'rotation-canary', 'DEK-rotation-does-not-change-business-data'),
      ),
    );
    return { owners, sealed };
  }
  it('分批中断可恢复、重复执行为0，业务密文不变且删除旧KEK后可读', async () => {
    const { owners, sealed } = await sample();
    const service = new EnvelopeCrypto(db, clock, ring);
    expect(await service.inspectKeys()).toEqual([{ version: 1, count: 4 }]);
    expect(await service.rotateKeyBatch(2)).toBe(2);
    expect(await service.inspectKeys()).toEqual([
      { version: 1, count: 2 },
      { version: 2, count: 2 },
    ]);
    const restarted = new EnvelopeCrypto(db, clock, ring);
    expect(await restarted.rotateKeyBatch(2)).toBe(2);
    expect(await restarted.rotateKeyBatch()).toBe(0);
    const fresh = new EnvelopeCrypto(db, clock, {
      currentVersion: 2,
      keys: new Map([[2, newKey]]),
    });
    for (let i = 0; i < owners.length; i++)
      expect((await fresh.open(owners[i]!, 'rotation-canary', sealed[i]!)).toString()).toBe(
        'DEK-rotation-does-not-change-business-data',
      );
    expect(await fresh.inspectKeys()).toEqual([{ version: 2, count: 4 }]);
    const dump = JSON.stringify(
      (await db.query("SELECT encode(wrapped_dek,'hex') AS wrapped FROM platform.user_data_keys"))
        .rows,
    );
    expect(dump).not.toContain(oldKey.toString('hex'));
    expect(dump).not.toContain(newKey.toString('hex'));
  });
  it('一批中存在损坏DEK时整批回滚，修复后可以继续', async () => {
    await sample();
    const last = (
      await db.query<{ owner: string; wrapped_dek: Buffer }>(
        'SELECT owner,wrapped_dek FROM platform.user_data_keys ORDER BY owner DESC LIMIT 1',
      )
    ).rows[0]!;
    const corrupted = Buffer.from(last.wrapped_dek);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    await db.query('UPDATE platform.user_data_keys SET wrapped_dek=$2 WHERE owner=$1', [
      last.owner,
      corrupted,
    ]);
    const service = new EnvelopeCrypto(db, clock, ring);
    await expect(service.rotateKeyBatch()).rejects.toBeInstanceOf(DecryptionError);
    expect(
      (
        await db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM platform.user_data_keys WHERE kek_version=1',
        )
      ).rows[0]?.n,
    ).toBe(4);
    await db.query('UPDATE platform.user_data_keys SET wrapped_dek=$2 WHERE owner=$1', [
      last.owner,
      last.wrapped_dek,
    ]);
    expect(await service.rotateKeyBatch()).toBe(4);
  });
  it('缺少旧主密钥拒绝修改、并发批次不重复包装、拒绝版本倒退', async () => {
    await sample();
    const missing = new EnvelopeCrypto(db, clock, {
      currentVersion: 2,
      keys: new Map([[2, newKey]]),
    });
    await expect(missing.inspectKeys()).rejects.toBeInstanceOf(DecryptionError);
    await expect(missing.rotateKeyBatch()).rejects.toBeInstanceOf(DecryptionError);
    const service = new EnvelopeCrypto(db, clock, ring);
    expect(await Promise.all([service.rotateKeyBatch(2), service.rotateKeyBatch(2)])).toEqual([
      2, 2,
    ]);
    const backward = new EnvelopeCrypto(db, clock, {
      currentVersion: 1,
      keys: new Map([
        [1, oldKey],
        [2, newKey],
      ]),
    });
    await expect(backward.rotateKeyBatch()).rejects.toThrow('旧版本');
    expect(await service.inspectKeys()).toEqual([{ version: 2, count: 4 }]);
  });
});
