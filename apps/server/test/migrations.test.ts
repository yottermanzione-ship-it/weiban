/**
 * 验收：数据库迁移能执行和回滚；集成测试使用 TEST_DATABASE_URL。
 */
import { cpSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { Migrator, readMigrations } from '../src/platform/db/migrator.js';
import {
  describeDb,
  dropEverything,
  MIGRATIONS_DIR,
  requireTestDatabaseUrl,
  withClient,
} from './support/db.js';

async function platformTables(): Promise<string[]> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'platform' ORDER BY 1`,
    );
    return rows.map((r) => r.table_name);
  });
}

it('每个迁移都有手写的回滚脚本', () => {
  const files = readMigrations(MIGRATIONS_DIR);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) expect(file.downSql, `${file.tag}.down.sql`).not.toBeNull();
  const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  expect(sqlFiles.length).toBe(files.length * 2);
});

describeDb('数据库迁移（真实 PostgreSQL）', () => {
  let url: string;
  beforeAll(async () => {
    url = requireTestDatabaseUrl();
    await dropEverything(url);
  });

  it('执行 → 回滚 → 再执行，结构与记录都正确', async () => {
    const migrator = new Migrator(url, MIGRATIONS_DIR);
    const applied = await migrator.up();
    expect(applied).toContain('0000_platform_kernel');
    expect(await platformTables()).toEqual([
      'audit_log',
      'event_inbox',
      'outbox',
      'user_data_keys',
    ]);
    expect(await migrator.up()).toEqual([]); // 重复执行无副作用

    const rolledBack = await migrator.down(1);
    expect(rolledBack).toEqual(['0000_platform_kernel']);
    expect(await platformTables()).toEqual([]);
    expect((await migrator.status()).every((s) => !s.applied)).toBe(true);

    expect(await migrator.up()).toEqual(['0000_platform_kernel']);
    expect(await platformTables()).toHaveLength(4);
  });

  it('已执行的迁移被改动时拒绝继续（迁移只增不改）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weiban-mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(join(dir, '0000_platform_kernel.sql'), '-- 被改过\nSELECT 1;');
    await expect(new Migrator(url, dir).up()).rejects.toThrow(/被修改过/);
  });

  it('迁移失败时整个迁移回滚，不留半截结构', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weiban-mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const journalPath = join(dir, 'meta', '_journal.json');
    writeFileSync(
      journalPath,
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, version: '7', when: 0, tag: '0000_platform_kernel', breakpoints: true },
          { idx: 1, version: '7', when: 1, tag: '0001_broken', breakpoints: true },
        ],
      }),
    );
    writeFileSync(
      join(dir, '0001_broken.sql'),
      'CREATE TABLE platform.half_done (id int);\nSELECT * FROM no_such_table;',
    );
    writeFileSync(join(dir, '0001_broken.down.sql'), 'DROP TABLE IF EXISTS platform.half_done;');
    await expect(new Migrator(url, dir).up()).rejects.toThrow();
    expect(await platformTables()).not.toContain('half_done');
  });
});
