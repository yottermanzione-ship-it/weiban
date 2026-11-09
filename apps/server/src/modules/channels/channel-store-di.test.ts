/**
 * ChannelStore 的**真实 Nest DI** 解析测试（2026-10-25 线上 /api/v1/channels 500 的回归）。
 *
 * 背景：服务器用 esbuild 打包 / tsx 运行，都不生成 design:paramtypes；`constructor(private db: Database)`
 * 这种隐式类型注入会拿到 undefined，接口在运行期才 500。kernel.md 的动作要求一直写得很清楚：
 * 构造注入一律显式 `@Inject(令牌)`。这个用例不用 `new ChannelStore(...)`，而是让 Nest 自己解析，
 * 证明「注入真的发生了」，并用 mock 的 db.query 证明 bindingsOf 走到了数据库。
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { DATABASE } from '../../platform/index.js';
import { ChannelStore } from './application/channel-store.js';

describe('ChannelStore 的真实 Nest DI', () => {
  it('注销在同一事务删除全部legacy映射与认证密文，并保持其他用户', async () => {
    const connection = new DatabaseSync(':memory:');
    const owner = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    connection.exec(`
      ATTACH DATABASE ':memory:' AS channels;
      CREATE TABLE channels.bindings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      CREATE TABLE channels.qq_sessions(binding_id TEXT NOT NULL);
      CREATE TABLE channels.bind_attempts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      CREATE TABLE channels.inbound_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      CREATE TABLE channels.outbound_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      CREATE TABLE channels.legacy_bindings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,auth_key_sealed BLOB NOT NULL);
    `);
    for (const user of [owner, other]) {
      connection.prepare('INSERT INTO channels.bindings VALUES(?,?)').run(user, user);
      connection.prepare('INSERT INTO channels.qq_sessions VALUES(?)').run(user);
      for (const table of ['bind_attempts', 'inbound_messages', 'outbound_messages'])
        connection.prepare(`INSERT INTO channels.${table} VALUES(?,?)`).run(user, user);
      connection
        .prepare('INSERT INTO channels.legacy_bindings VALUES(?,?,?)')
        .run(user, user, Buffer.from('synthetic sealed auth'));
    }
    connection
      .prepare('INSERT INTO channels.legacy_bindings VALUES(?,?,?)')
      .run('second-slot', owner, Buffer.from('another synthetic sealed auth'));
    let transactionActive = false;
    const query = async (text: string, values: unknown[] = []) => {
      const parameters: string[] = [];
      // Execute the owning store's real SQL; only adapt PostgreSQL parameter/cast syntax to SQLite.
      const sql = text.replace(/::text/g, '').replace(/\$(\d+)/g, (_match, position: string) => {
        parameters.push(String(values[Number(position) - 1]));
        return '?';
      });
      if (/^\s*SELECT/.test(sql)) {
        const rows = connection.prepare(sql).all(...parameters);
        return { rows, rowCount: rows.length };
      }
      expect(transactionActive).toBe(true);
      const result = connection.prepare(sql).run(...parameters);
      return { rows: [], rowCount: Number(result.changes) };
    };
    const database = {
      query,
      transaction: async (work: (tx: { query: typeof query }) => Promise<number>) => {
        connection.exec('BEGIN');
        transactionActive = true;
        try {
          const count = await work({ query });
          connection.exec('COMMIT');
          return count;
        } catch (error) {
          connection.exec('ROLLBACK');
          throw error;
        } finally {
          transactionActive = false;
        }
      },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelStore, { provide: DATABASE, useValue: database }],
    }).compile();
    try {
      const store = moduleRef.get(ChannelStore);
      expect(await store.countUserData(owner)).toBe(7);
      expect(await store.purgeUser(owner)).toBe(7);
      expect(await store.countUserData(owner)).toBe(0);
      expect(
        connection
          .prepare('SELECT count(*) AS n FROM channels.legacy_bindings WHERE user_id=?')
          .get(owner)?.n,
      ).toBe(0);
      expect(await store.countUserData(other)).toBe(6);
      expect(
        connection
          .prepare(
            'SELECT count(*) AS n FROM channels.legacy_bindings WHERE user_id=? AND auth_key_sealed IS NOT NULL',
          )
          .get(other)?.n,
      ).toBe(1);
      expect(await store.purgeUser(owner)).toBe(0);
    } finally {
      await moduleRef.close();
      connection.close();
    }
  });

  it('Nest 解析出的 store 拿到注入的 DATABASE，bindingsOf 真的调用 db.query', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const query = async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ChannelStore, { provide: DATABASE, useValue: { query } }],
    }).compile();
    try {
      // 关键：从容器取，而不是 new。esbuild 下隐式注入会让这里拿到 undefined 并在调用时炸。
      const store = moduleRef.get(ChannelStore);
      const userId = '11111111-1111-1111-1111-111111111111';
      await expect(store.bindingsOf(userId)).resolves.toEqual([]);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toContain('FROM channels.bindings');
      expect(calls[0]!.values).toEqual([userId]);
    } finally {
      await moduleRef.close();
    }
  });
});
