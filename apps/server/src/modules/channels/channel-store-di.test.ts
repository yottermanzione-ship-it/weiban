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
import { DATABASE } from '../../platform/index.js';
import { ChannelStore } from './application/channel-store.js';

describe('ChannelStore 的真实 Nest DI', () => {
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
