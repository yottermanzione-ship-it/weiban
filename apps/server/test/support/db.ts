/**
 * 集成测试的数据库工具。集成测试一律连 TEST_DATABASE_URL（weiban_test 库，可以随意清空），绝不连开发库。
 *
 * 没有设置 TEST_DATABASE_URL 时（例如没有数据库的 CI），集成测试整组跳过并打印提示；
 * 设置了但连不上时测试失败（提示先 `pnpm db:up`）。
 */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe } from 'vitest';
import { Migrator } from '../../src/platform/db/migrator.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? null;

if (!TEST_DATABASE_URL) {
  console.warn(
    '[server 集成测试] 未设置 TEST_DATABASE_URL，跳过需要数据库的测试（本机请先 pnpm db:up 并复制 .env）',
  );
}

/** 需要数据库的测试组：没有 TEST_DATABASE_URL 时跳过。 */
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

export function requireTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) throw new Error('未设置 TEST_DATABASE_URL');
  if (/\/weiban(\?|$)/.test(TEST_DATABASE_URL)) {
    throw new Error('TEST_DATABASE_URL 指向了开发库 weiban，拒绝在上面跑测试');
  }
  return TEST_DATABASE_URL;
}

/** 清空测试库里本项目的全部结构（platform、pgboss、迁移记录），再执行全部迁移。 */
export async function resetTestDatabase(): Promise<void> {
  const url = requireTestDatabaseUrl();
  await dropEverything(url);
  await new Migrator(url, MIGRATIONS_DIR).up();
}

export async function dropEverything(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`连不上测试库（请先 pnpm db:up）：${(error as Error).message}`, {
      cause: error,
    });
  }
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg\\_%'`,
    );
    for (const { nspname } of rows) {
      await client.query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }
    await client.query('DROP TABLE IF EXISTS public.schema_migrations');
  } finally {
    await client.end();
  }
}

/** 直接查询测试库（断言用）。 */
export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: requireTestDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
