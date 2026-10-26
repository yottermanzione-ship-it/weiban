/**
 * 10-25 会员 v6：RoleRequestService.quota() 的取值口径（免费 = 终身 3 次；PRO+ = 本周 3 次，不再叠加）。
 * 这里只假 DB 的两条计数（plaza 配置 + 免费次数），计数按服务里 WHERE 条件出现的关键字返回，
 * 所以 SQL 少写一个过滤条件（例如 PRO+ 周计数只算 weekly）时用例会失败。
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { RoleRequestConfig } from '@weiban/contracts';
import { TestClock } from '../../../platform/index.js';
import { plazaSettings } from '../infra/db/schema.js';
import { RoleRequestService } from './role-requests.service.js';

/** 周日 2026-10-25 21:00（北京时间），北京自然周 = 10-19 00:00 ~ 10-26 00:00。 */
const SUNDAY = '2026-10-25T21:00:00+08:00';
const clock = new TestClock(SUNDAY);
const NOTHING_USED = { lifetimeBeforeThisWeek: 0, lifetimeThisWeek: 0, weeklyThisWeek: 0 };

/** 已计入的免费申请分布（都是 pending / in_progress / completed）。 */
interface FreeUsage {
  /** 本周以前用掉的终身免费次数。 */
  lifetimeBeforeThisWeek: number;
  /** 本周用掉的终身免费次数（升级 PRO+ 前用掉的，应同样占当周额度）。 */
  lifetimeThisWeek: number;
  /** 本周用掉的 PRO+ 每周免费次数。 */
  weeklyThisWeek: number;
}

/** 条件里是否引用了某个标识（列名或参数值），用来按 WHERE 条件选择返回哪个计数。 */
function mentions(value: unknown, needle: string, seen = new Set<unknown>()): boolean {
  if (typeof value === 'string') return value.includes(needle);
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if ((value as { name?: unknown }).name === needle) return true;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    // table / session / schema 是回指，和计数口径无关且会成环。
    if (key === 'table' || key === 'session' || key === 'schema') continue;
    if (Array.isArray(child)) {
      for (const item of child) if (mentions(item, needle, seen)) return true;
    } else if (mentions(child, needle, seen)) return true;
  }
  return false;
}

/** 服务里 this.db 是 Database，this.db.db 才是 drizzle 实例。 */
function fakeStore(config: Partial<RoleRequestConfig> | null, usage: FreeUsage) {
  const drizzle = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => {
          if (table === plazaSettings)
            return Promise.resolve(config ? [{ key: 'role_request_config', value: config }] : []);
          // 只按类别过滤（coalesce(kind,'lifetime') = 'lifetime'）：终身次数。
          if (mentions(condition, 'weekly')) return Promise.resolve([{ n: usage.weeklyThisWeek }]);
          if (mentions(condition, 'free_quota_kind'))
            return Promise.resolve([{ n: usage.lifetimeBeforeThisWeek + usage.lifetimeThisWeek }]);
          // 只看时间窗（PRO+ 周额度）：本周所有计入的免费申请，不分类别。
          return Promise.resolve([{ n: usage.lifetimeThisWeek + usage.weeklyThisWeek }]);
        },
      }),
    }),
  };
  return { db: { db: drizzle }, clock };
}

function service(
  tier: 'free' | 'pro_plus',
  config: Partial<RoleRequestConfig> | null,
  usage: FreeUsage,
): RoleRequestService {
  const instance = Object.create(RoleRequestService.prototype) as RoleRequestService;
  Object.assign(instance, {
    store: fakeStore(config, usage),
    membership: {
      getMembership: async () => ({
        checkedAt: clock.now().toISOString(),
        tier,
        expiresAt: null,
        updatedAt: null,
      }),
    },
  });
  return instance;
}

describe('RoleRequestService.quota（会员 v6）', () => {
  it('免费用户：终身 3 次用完后第 4 次没有免费名额，报价 200 积分', async () => {
    const before = await service('free', null, {
      ...NOTHING_USED,
      lifetimeThisWeek: 2,
    }).quota('user');
    expect(before).toMatchObject({
      tier: 'free',
      limit: 3,
      used: 2,
      remaining: 1,
      nextPointsCost: 0,
      lifetimeLimit: 3,
      weeklyLimit: 0,
    });

    const fourth = await service('free', null, {
      ...NOTHING_USED,
      lifetimeThisWeek: 3,
    }).quota('user');
    expect(fourth).toMatchObject({
      tier: 'free',
      limit: 3,
      used: 3,
      remaining: 0,
      nextPointsCost: 200,
    });
    expect(fourth.quotedAt).toBe(clock.now().toISOString());
  });

  it('PRO+：同周第 4 次没有免费名额；有效额度只算本周，不与终身次数相加', async () => {
    const fourth = await service('pro_plus', null, {
      ...NOTHING_USED,
      lifetimeBeforeThisWeek: 3,
      weeklyThisWeek: 3,
    }).quota('user');
    expect(fourth).toMatchObject({
      tier: 'pro_plus',
      limit: 3,
      used: 3,
      remaining: 0,
      nextPointsCost: 200,
      weeklyLimit: 3,
      weeklyUsed: 3,
    });
    // 终身次数已用满也不恢复 PRO+ 的额度：limit 仍是 3 而不是 6。
    expect(fourth.limit).not.toBe(6);
  });

  it('PRO+：本周先用掉的终身免费次数同样占当周额度（升级 / 旧数据不会同周叠加）', async () => {
    // 本周：升级前用掉 3 次终身免费；没有 weekly 记录。周额度应已被占满。
    const quota = await service('pro_plus', null, {
      ...NOTHING_USED,
      lifetimeThisWeek: 3,
    }).quota('user');
    expect(quota).toMatchObject({
      tier: 'pro_plus',
      limit: 3,
      used: 3,
      remaining: 0,
      nextPointsCost: 200,
      weeklyLimit: 3,
      weeklyUsed: 3,
    });

    // 本周先用 2 次终身：PRO+ 本周只剩 1 次（不是 1 + 3）。
    const partial = await service('pro_plus', null, {
      ...NOTHING_USED,
      lifetimeThisWeek: 2,
    }).quota('user');
    expect(partial).toMatchObject({ remaining: 1, weeklyUsed: 2, nextPointsCost: 0 });
  });

  it('PRO+ 本周没用过时是 3 次（默认值），周期按北京时间周一开始', async () => {
    // 上周用满的终身次数不影响本周额度（周计数只看时间窗）。
    const quota = await service('pro_plus', null, {
      ...NOTHING_USED,
      lifetimeBeforeThisWeek: 3,
    }).quota('user');
    expect(quota).toMatchObject({
      tier: 'pro_plus',
      limit: 3,
      used: 0,
      remaining: 3,
      nextPointsCost: 0,
      weeklyLimit: 3,
      weeklyUsed: 0,
    });
    expect(quota.periodStart).toBe('2026-10-18T16:00:00.000Z');
    expect(quota.periodEnd).toBe('2026-10-25T16:00:00.000Z');
    expect(quota.timeZone).toBe('Asia/Shanghai');
  });

  it('后台配置缺 PRO+ 每周次数时用新默认值 3（不再是 2）', async () => {
    const config: Partial<RoleRequestConfig> = {
      enabled: true,
      pointsCost: 200,
      maxOpenPerUser: 3,
    };
    const quota = await service('pro_plus', config, NOTHING_USED).quota('user');
    expect(quota.weeklyLimit).toBe(3);
    expect(quota.remaining).toBe(3);
  });

  it('后台把 PRO+ 每周次数调成 5 时按配置走', async () => {
    const config: Partial<RoleRequestConfig> = {
      enabled: true,
      pointsCost: 200,
      maxOpenPerUser: 3,
      proPlusWeeklyFreeCount: 5,
    };
    const quota = await service('pro_plus', config, {
      ...NOTHING_USED,
      weeklyThisWeek: 4,
    }).quota('user');
    expect(quota).toMatchObject({ limit: 5, used: 4, remaining: 1, nextPointsCost: 0 });
  });
});
