/**
 * 年度回忆服务（10-25 会员 v6）：假 Clock、幂等、隔离、正常 ACL、提前读拒绝、夜间跨日、无常驻手动入口。
 *
 * 不连数据库：recap 自己的表用 `Database.query` 的最小内存实现；chat 侧是端口假实现，
 * 所以这里验证的是「服务怎么用这些数据」，而不是 SQL 本身（SQL 的可见口径在 chat 模块里）。
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  AnnualRecap,
  RecapEndpoints,
  type ChatRecapAggregates,
  type ChatRecapReadPort,
  type ChatRecapWindow,
  type CharacterNameReadPort,
  type IdentityMembershipReadPort,
  type PushPort,
  type PushRequest,
  type SyncPort,
  type UserUpdatePayload,
} from '@weiban/contracts';
import { TestClock } from '../../../platform/index.js';
import { RecapService } from './recap.service.js';

const CUTOFF = '2026-12-31T22:00:00+08:00';
const PRO = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FREE = '33333333-3333-4333-8333-333333333333';
const LATE = '44444444-4444-4444-8444-444444444444';
const NOBODY = '55555555-5555-4555-8555-555555555555';
const EMPTY = '66666666-6666-4666-8666-666666666666';
const CHARACTER = '77777777-7777-4777-8777-777777777777';
const CONVERSATION_A = '88888888-8888-4888-8888-888888888888';
const CONVERSATION_B = '99999999-9999-4999-8999-999999999999';

interface Row {
  id: string;
  userId: string;
  year: number;
  payload: Buffer;
  generatedAt: Date;
  seenAt: Date | null;
}

/** 最小内存实现：只认服务里实际用到的几条 SQL（含幂等插入与按用户隔离）。 */
class MemoryDb {
  readonly rows = new Map<string, Row>();
  readonly statements: Array<{ sql: string; args: unknown[] }> = [];

  async query(sql: string, args: unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> {
    this.statements.push({ sql, args });
    if (sql.includes('INSERT INTO recap.year_recaps')) {
      const [id, userId, year, payload] = args as [string, string, number, Buffer];
      const key = `${userId}:${year}`;
      if (this.rows.has(key)) return { rows: [], rowCount: 0 };
      this.rows.set(key, {
        id,
        userId,
        year,
        payload,
        generatedAt: args[4] instanceof Date ? args[4] : new Date(String(args[4])),
        seenAt: null,
      });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.includes('SELECT id::text AS id, year, payload_ciphertext, generated_at')) {
      const userId = args[0];
      const pending = [...this.rows.values()]
        .filter((row) => row.userId === userId && row.seenAt === null)
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      return {
        rows: pending.slice(0, 1).map((row) => ({
          id: row.id,
          year: row.year,
          payload_ciphertext: row.payload,
          generated_at: row.generatedAt,
        })),
        rowCount: Math.min(pending.length, 1),
      };
    }
    if (sql.includes('UPDATE recap.year_recaps SET seen_at')) {
      const userId = args[0];
      const pending = [...this.rows.values()]
        .filter((row) => row.userId === userId && row.seenAt === null)
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime())[0];
      if (!pending) return { rows: [], rowCount: 0 };
      pending.seenAt = new Date(String(args[1]));
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('SET delivered_at')) return { rows: [], rowCount: 1 };
    if (sql.includes('DELETE FROM recap.year_recaps')) {
      const userId = args[0];
      let deleted = 0;
      for (const [key, row] of this.rows)
        if (row.userId === userId) {
          this.rows.delete(key);
          deleted += 1;
        }
      return { rows: [], rowCount: deleted };
    }
    if (sql.includes('SELECT count(*)::int AS n FROM recap.year_recaps')) {
      const userId = args[0];
      const n = [...this.rows.values()].filter((row) => row.userId === userId).length;
      return { rows: [{ n }], rowCount: 1 };
    }
    throw new Error(`MemoryDb 不认识的 SQL：${sql.slice(0, 60)}`);
  }
}

function aggregates(override: Partial<ChatRecapAggregates> = {}): ChatRecapAggregates {
  return {
    totalMessages: 120,
    userMessages: 50,
    characterMessages: 70,
    groupMessages: 20,
    directMessages: 100,
    characterCount: 2,
    activeDays: 9,
    monthlyUserMessages: Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      count: index === 9 ? 30 : 0,
    })),
    topCharacters: [
      { characterId: CHARACTER, userMessages: 40, lastMessageAt: '2026-10-03T12:00:00.000Z' },
    ],
    busiestDays: [{ date: '2026-10-03', userMessages: 21, totalMessages: 40 }],
    nightCandidates: [],
    nightCount: 0,
    activeDates: ['2026-10-01', '2026-10-02', '2026-10-03'],
    migratedMessages: 0,
    ...override,
  };
}

interface HarnessOptions {
  proUsers?: Record<string, { tier: 'free' | 'pro_plus'; updatedAt?: string | null }>;
  aggregatesByUser?: Record<string, ChatRecapAggregates>;
  candidates?: string[][];
}

function buildHarness(options: HarnessOptions = {}) {
  const clock = new TestClock(CUTOFF);
  const db = new MemoryDb();
  const sealed: Array<{ owner: string; aad: string; json: string }> = [];
  const pushes: PushRequest[] = [];
  const updates: Array<{ userId: string; update: UserUpdatePayload }> = [];
  const aggregateCalls: Array<{ userId: string; window: ChatRecapWindow }> = [];
  const candidateCalls: Array<{ afterUserId?: string }> = [];
  const candidatePages = [...(options.candidates ?? [[PRO]])];
  const proUsers = options.proUsers ?? {
    [PRO]: { tier: 'pro_plus' as const, updatedAt: '2026-11-01T00:00:00.000Z' },
  };
  const registered: string[] = [];

  const chat: ChatRecapReadPort = {
    recapCandidates: async (input) => {
      candidateCalls.push({ afterUserId: input.afterUserId });
      return { userIds: candidatePages.shift() ?? [] };
    },
    recapAggregates: async (userId, window) => {
      aggregateCalls.push({ userId, window });
      return options.aggregatesByUser?.[userId] ?? aggregates();
    },
  };
  const membership = {
    getMembership: async (userId: string) => {
      const record = proUsers[userId] ?? { tier: 'free' as const };
      return {
        checkedAt: clock.now().toISOString(),
        tier: record.tier,
        expiresAt: record.tier === 'pro_plus' ? '2027-06-01T00:00:00.000Z' : null,
        updatedAt: record.updatedAt ?? null,
      };
    },
    isProPlus: async (userId: string) => (proUsers[userId]?.tier ?? 'free') === 'pro_plus',
  } as unknown as IdentityMembershipReadPort;
  const names: CharacterNameReadPort = { getDisplayName: async () => '小青' };
  const push = {
    send: async (request: PushRequest) => {
      pushes.push(request);
      return { delivered: true };
    },
  } as unknown as PushPort;
  const sync = {
    appendUpdate: async (_tx: unknown, userId: string, update: UserUpdatePayload) => {
      updates.push({ userId, update });
    },
  } as unknown as SyncPort;

  const service = Object.create(RecapService.prototype) as RecapService;
  Object.assign(service, {
    db: {
      query: (sql: string, args?: unknown[]) => db.query(sql, args),
      transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}),
    },
    clock,
    crypto: {
      seal: async (owner: string, aad: string, plaintext: string) => {
        sealed.push({ owner, aad, json: plaintext });
        return Buffer.from(plaintext, 'utf8');
      },
      open: async (owner: string, aad: string, sealedValue: Buffer) => {
        expect(aad).toBe('recap:year:2026');
        expect(owner).toBeTypeOf('string');
        return Buffer.from(sealedValue);
      },
    },
    jobs: {
      work: async () => undefined,
      schedule: async () => undefined,
    },
    registry: {
      register: (owner: { module: string }) => {
        if (owner.module !== 'recap') throw new Error('模块名必须是 recap');
        registered.push(owner.module);
      },
    },
    chat,
    membership,
    names,
    logger: { info: () => undefined, warn: () => undefined },
    push,
    sync,
  });
  return {
    service,
    clock,
    db,
    sealed,
    pushes,
    updates,
    aggregateCalls,
    candidateCalls,
    registered,
  };
}

describe('年度回忆服务（会员 v6）', () => {
  it('12-31 22:00（北京）才生成；提前触发什么都不做', async () => {
    const early = buildHarness();
    early.clock.set('2026-12-31T21:59:00+08:00');
    expect(await early.service.generate(2026, { retry: false })).toEqual({
      year: 2026,
      candidates: 0,
      generated: 0,
      skipped: 0,
    });
    expect(early.aggregateCalls).toHaveLength(0);
    expect(early.db.rows.size).toBe(0);

    const onTime = buildHarness();
    expect(await onTime.service.generate(2026, { retry: false })).toEqual({
      year: 2026,
      candidates: 1,
      generated: 1,
      skipped: 0,
    });
    // 统计窗口就是 [当年 1-1 00:00, 12-31 22:00)（北京时间）。
    expect(onTime.aggregateCalls[0]?.window.fromIso).toBe('2025-12-31T16:00:00.000Z');
    expect(onTime.aggregateCalls[0]?.window.toIso).toBe('2026-12-31T14:00:00.000Z');
    expect(onTime.aggregateCalls[0]?.userId).toBe(PRO);
    expect(onTime.sealed[0]?.owner).toBe(PRO);
    expect(onTime.sealed[0]?.aad).toBe('recap:year:2026');
    expect(onTime.pushes).toHaveLength(1);
    expect(onTime.pushes[0]?.title).toBe('年度回忆已准备好');
    // 推送不泄露角色 / 内容。
    expect(JSON.stringify(onTime.pushes[0])).not.toContain('小青');
    expect(onTime.updates).toEqual([
      {
        userId: PRO,
        update: {
          type: 'data.changed',
          data: { section: 'recap', characterId: null, itemId: null },
        },
      },
    ]);
  });

  it('幂等：同一用户同一年只有一份，重跑命中唯一键、不再推送', async () => {
    const harness = buildHarness({ candidates: [[PRO], [PRO]] });
    await harness.service.generate(2026, { retry: false });
    const again = await harness.service.generate(2026, { retry: false });
    expect(again).toEqual({ year: 2026, candidates: 1, generated: 0, skipped: 1 });
    expect(harness.db.rows.size).toBe(1);
    expect(harness.pushes).toHaveLength(1);
    expect(harness.updates).toHaveLength(1);
  });

  it('只有 PRO+ 生成；补跑不给「新年才开通」的人补上一年', async () => {
    const harness = buildHarness({
      candidates: [[PRO, FREE, LATE]],
      proUsers: {
        [PRO]: { tier: 'pro_plus', updatedAt: '2026-11-01T00:00:00.000Z' },
        [FREE]: { tier: 'free' },
        [LATE]: { tier: 'pro_plus', updatedAt: '2027-01-02T00:00:00.000Z' },
      },
    });
    harness.clock.set('2027-01-03T03:15:00+08:00');
    const result = await harness.service.generate(2026, { retry: true });
    expect(result.candidates).toBe(3);
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(2);
    expect([...harness.db.rows.values()].map((row) => row.userId)).toEqual([PRO]);
  });

  it('没有可见消息的用户不生成空壳', async () => {
    const harness = buildHarness({
      candidates: [[EMPTY]],
      proUsers: { [EMPTY]: { tier: 'pro_plus', updatedAt: '2026-11-01T00:00:00.000Z' } },
      aggregatesByUser: {
        [EMPTY]: aggregates({
          totalMessages: 0,
          userMessages: 0,
          characterMessages: 0,
          activeDays: 0,
        }),
      },
    });
    const result = await harness.service.generate(2026, { retry: false });
    expect(result.generated).toBe(0);
    expect(harness.db.rows.size).toBe(0);
    expect(harness.pushes).toHaveLength(0);
  });

  it('隔离：只能读自己的那一份，标记已读也只动自己的行', async () => {
    const harness = buildHarness({
      candidates: [[PRO, OTHER]],
      proUsers: {
        [PRO]: { tier: 'pro_plus', updatedAt: '2026-11-01T00:00:00.000Z' },
        [OTHER]: { tier: 'pro_plus', updatedAt: '2026-11-01T00:00:00.000Z' },
      },
    });
    await harness.service.generate(2026, { retry: false });
    expect(harness.db.rows.size).toBe(2);

    expect(await harness.service.getPending(PRO)).not.toBeNull();
    const pendingQueries = harness.db.statements.filter((item) =>
      item.sql.includes('SELECT id::text AS id, year, payload_ciphertext'),
    );
    expect(pendingQueries[0]?.args[0]).toBe(PRO);
    // 一份文件都没有的账号读不到别人的报告。
    expect(await harness.service.getPending(NOBODY)).toBeNull();

    await harness.service.markSeen(PRO);
    const seenQuery = harness.db.statements.find((item) => item.sql.includes('SET seen_at'));
    expect(seenQuery?.args[0]).toBe(PRO);
    expect(await harness.service.getPending(PRO)).toBeNull();
    // 别人的那一份没有被标记掉。
    expect(await harness.service.getPending(OTHER)).not.toBeNull();
  });

  it('会员到期不影响已经生成的那一份（本人仍能收下）', async () => {
    const harness = buildHarness();
    await harness.service.generate(2026, { retry: false });
    // 第二天会员到期：读接口不再看会员档位。
    harness.clock.set('2027-01-01T09:00:00+08:00');
    Object.assign(harness.service, {
      membership: { getMembership: async () => ({ tier: 'free' }), isProPlus: async () => false },
    });
    expect(await harness.service.getPending(PRO)).not.toBeNull();
    await harness.service.markSeen(PRO);
    expect(await harness.service.getPending(PRO)).toBeNull();
  });

  it('夜间跨日：03:15 比 23:59 更晚，展示真实日期', async () => {
    const harness = buildHarness({
      aggregatesByUser: {
        [PRO]: aggregates({
          nightCount: 2,
          nightCandidates: [
            {
              date: '2026-03-07',
              time: '23:59',
              nightOffsetMinutes: 119,
              conversationId: CONVERSATION_A,
              characterId: CHARACTER,
              atIso: '2026-03-07T15:59:00.000Z',
            },
            {
              date: '2026-03-08',
              time: '03:15',
              nightOffsetMinutes: 315,
              conversationId: CONVERSATION_B,
              characterId: null,
              atIso: '2026-03-07T19:15:00.000Z',
            },
          ],
        }),
      },
    });
    await harness.service.generate(2026, { retry: false });
    const recap = await harness.service.getPending(PRO);
    expect(recap?.stats.latestNight).toEqual({
      date: '2026-03-08',
      time: '03:15',
      conversationId: CONVERSATION_B,
      characterId: null,
    });
    expect(recap?.lines.join('\n')).toContain('最晚的一次是 3 月 8 日 03:15');
  });

  it('契约里没有常驻的生成 / 列表 / 按年份查询入口', () => {
    expect(Object.keys(RecapEndpoints)).toEqual(['pending', 'markSeen']);
    const paths = Object.values(RecapEndpoints).map((endpoint) => endpoint.path);
    expect(paths).toEqual(['/api/v1/me/recap/pending', '/api/v1/me/recap/pending/seen']);
    for (const path of paths) {
      expect(path).not.toContain(':year');
      expect(path).not.toContain('generate');
      expect(path).not.toMatch(/\/recaps\//);
    }
    // 生成的入口只在服务层（任务调用），没有按年份对外暴露的读取方法。
    const prototype = RecapService.prototype as unknown as Record<string, unknown>;
    expect(prototype.getByYear).toBeUndefined();
    expect(prototype.list).toBeUndefined();
  });

  it('服务返回的对象符合 AnnualRecap 契约（统计、文案、口径都齐全）', async () => {
    const harness = buildHarness();
    await harness.service.generate(2026, { retry: false });
    const recap = await harness.service.getPending(PRO);
    expect(recap).not.toBeNull();
    expect(AnnualRecap.safeParse(recap).success).toBe(true);
    expect(recap?.year).toBe(2026);
    expect(recap?.cutoffNote).toContain('2026-12-31 22:00');
    expect(recap?.stats.topCharacters[0]?.name).toBe('小青');
    expect(recap?.stats.monthlyUserMessages).toHaveLength(12);
  });

  it('注销清理：删除本人的年报行且可重复执行', async () => {
    const harness = buildHarness();
    await harness.service.generate(2026, { retry: false });
    expect(await harness.service.countUserData(PRO)).toBe(1);
    expect(await harness.service.purgeUser(PRO)).toBe(1);
    expect(await harness.service.countUserData(PRO)).toBe(0);
    expect(await harness.service.purgeUser(PRO)).toBe(0);
  });
});
