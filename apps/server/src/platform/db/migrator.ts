/**
 * 数据库迁移执行器：执行（up）和回滚（down）。
 *
 * 迁移文件放在 apps/server/drizzle/（所有模块共用一条序列，repo-structure.md 第 3 节）：
 * - `NNNN_名字.sql`：由 drizzle-kit 生成（`pnpm --filter @weiban/server db:generate`），顺序以 meta/_journal.json 为准；
 * - `NNNN_名字.down.sql`：**手写**的回滚脚本（drizzle-kit 不生成回滚），每个迁移必须有，测试会检查。
 *
 * 执行记录在 public.schema_migrations（放在 public，因为第一个迁移才创建 platform schema，
 * 回滚它时记录表不能跟着被删）。每个迁移在自己的事务里执行；全程持有咨询锁，多个进程同时迁移会排队。
 * 已执行的迁移文件被改动（校验和不一致）时拒绝继续——迁移只增不改（engineering-standards.md 第 5 节第 4 条）。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const LOCK_KEY = 7_315_002_016; // 任意固定数字，只用于迁移的咨询锁

export interface MigrationFile {
  tag: string;
  upSql: string;
  downSql: string | null;
  checksum: string;
}

export interface MigrationStatus {
  tag: string;
  applied: boolean;
  appliedAt: Date | null;
}

interface JournalEntry {
  idx: number;
  tag: string;
}

/** 读取迁移目录：按 journal 顺序返回每个迁移的 up / down SQL。 */
export function readMigrations(dir: string): MigrationFile[] {
  const journalPath = join(dir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) return [];
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const upSql = normalize(readFileSync(join(dir, `${tag}.sql`), 'utf8'));
      const downPath = join(dir, `${tag}.down.sql`);
      const downSql = existsSync(downPath) ? normalize(readFileSync(downPath, 'utf8')) : null;
      return { tag, upSql, downSql, checksum: createHash('sha256').update(upSql).digest('hex') };
    });
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export class Migrator {
  constructor(
    private readonly databaseUrl: string,
    private readonly dir: string,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  /** 执行所有未执行的迁移，返回本次执行的 tag 列表。 */
  async up(): Promise<string[]> {
    return this.withLockedClient(async (client) => {
      const files = readMigrations(this.dir);
      const applied = await this.appliedMap(client);
      this.verifyApplied(files, applied);
      const done: string[] = [];
      for (const file of files) {
        if (applied.has(file.tag)) continue;
        if (file.downSql === null) {
          throw new Error(`迁移 ${file.tag} 缺少回滚脚本 ${file.tag}.down.sql`);
        }
        await this.inTransaction(client, async () => {
          await client.query(file.upSql);
          await client.query(
            'INSERT INTO public.schema_migrations (tag, checksum, applied_at) VALUES ($1, $2, now())',
            [file.tag, file.checksum],
          );
        });
        this.log(`已执行迁移 ${file.tag}`);
        done.push(file.tag);
      }
      return done;
    });
  }

  /** 回滚最近执行的 steps 个迁移（默认 1 个），返回被回滚的 tag 列表。 */
  async down(steps = 1): Promise<string[]> {
    return this.withLockedClient(async (client) => {
      const files = new Map(readMigrations(this.dir).map((file) => [file.tag, file]));
      const { rows } = await client.query<{ tag: string }>(
        'SELECT tag FROM public.schema_migrations ORDER BY applied_at DESC, tag DESC LIMIT $1',
        [steps],
      );
      const done: string[] = [];
      for (const { tag } of rows) {
        const file = files.get(tag);
        if (!file?.downSql) throw new Error(`迁移 ${tag} 找不到回滚脚本，无法回滚`);
        const downSql = file.downSql;
        await this.inTransaction(client, async () => {
          await client.query(downSql);
          await client.query('DELETE FROM public.schema_migrations WHERE tag = $1', [tag]);
        });
        this.log(`已回滚迁移 ${tag}`);
        done.push(tag);
      }
      return done;
    });
  }

  async status(): Promise<MigrationStatus[]> {
    return this.withLockedClient(async (client) => {
      const applied = await this.appliedMap(client);
      return readMigrations(this.dir).map((file) => ({
        tag: file.tag,
        applied: applied.has(file.tag),
        appliedAt: applied.get(file.tag)?.appliedAt ?? null,
      }));
    });
  }

  private verifyApplied(
    files: MigrationFile[],
    applied: Map<string, { checksum: string; appliedAt: Date }>,
  ): void {
    const byTag = new Map(files.map((file) => [file.tag, file]));
    for (const [tag, record] of applied) {
      const file = byTag.get(tag);
      if (!file) throw new Error(`数据库里记录了迁移 ${tag}，但迁移目录里没有这个文件`);
      if (file.checksum !== record.checksum) {
        throw new Error(`已执行的迁移 ${tag} 被修改过（校验和不一致）。迁移只增不改，请新增一个迁移`);
      }
    }
  }

  private async appliedMap(
    client: pg.Client,
  ): Promise<Map<string, { checksum: string; appliedAt: Date }>> {
    const { rows } = await client.query<{ tag: string; checksum: string; applied_at: Date }>(
      'SELECT tag, checksum, applied_at FROM public.schema_migrations',
    );
    return new Map(rows.map((r) => [r.tag, { checksum: r.checksum, appliedAt: r.applied_at }]));
  }

  private async inTransaction(client: pg.Client, fn: () => Promise<void>): Promise<void> {
    await client.query('BEGIN');
    try {
      await fn();
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  private async withLockedClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          tag text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL
        )`);
      return await fn(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
      await client.end();
    }
  }
}
