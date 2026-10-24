/**
 * 10-25 会员 v6：角色制作免费次数的规则（总经理裁定：免费 3 次不变；PRO+ 改为每周 3 次，不再叠加终身次数）。
 * 覆盖：免费第 4 次被拒（不再有免费名额）、PRO+ 同周第 4 次被拒、跨周恢复（北京时间周一 0 点）。
 */
import { describe, expect, it } from 'vitest';
import {
  QUOTA_TIME_ZONE,
  computeRoleRequestQuota,
  quotaWeekWindow,
  type QuotaWeekWindow,
  type RoleRequestQuotaFacts,
} from './role-request-quota.js';

const CONFIG = { lifetimeFreeCount: 3, proPlusWeeklyFreeCount: 3, pointsCost: 200 };
/** 周日 2026-10-25 21:00（北京时间），属于 10-19 那一周。 */
const SUNDAY = new Date('2026-10-25T21:00:00+08:00');
/** 周一 2026-10-26 00:00（北京时间），新的一周开始。 */
const MONDAY = new Date('2026-10-26T00:00:00+08:00');

function facts(at: Date, override: Partial<RoleRequestQuotaFacts> = {}): RoleRequestQuotaFacts {
  return {
    tier: 'free',
    lifetimeUsed: 0,
    weeklyUsed: 0,
    ...CONFIG,
    quotedAt: at.toISOString(),
    ...override,
  };
}

/** 与服务端 SQL 同样的口径：只有落在本周窗口内的 weekly 申请占本周次数。 */
function weeklyUsedInWindow(createdAt: Date[], window: QuotaWeekWindow): number {
  return createdAt.filter((at) => at >= window.start && at < window.end).length;
}

describe('角色制作免费次数（会员 v6）', () => {
  it('免费用户：终身 3 次，第 4 次不再有免费名额、按 200 积分/次', () => {
    const window = quotaWeekWindow(SUNDAY);
    // 第 1～3 次都能用免费次数（remaining 依次 3 → 2 → 1）。
    expect(computeRoleRequestQuota(facts(SUNDAY), window).quota.remaining).toBe(3);
    expect(computeRoleRequestQuota(facts(SUNDAY, { lifetimeUsed: 1 }), window).quota).toMatchObject(
      { limit: 3, used: 1, remaining: 2, nextPointsCost: 0 },
    );
    const third = computeRoleRequestQuota(facts(SUNDAY, { lifetimeUsed: 2 }), window);
    expect(third.nextKind).toBe('lifetime');
    expect(third.quota.remaining).toBe(1);

    // 第 4 次：免费名额已用完 → nextKind = null、本次报价 200 积分（免费次数被拒）。
    const fourth = computeRoleRequestQuota(facts(SUNDAY, { lifetimeUsed: 3 }), window);
    expect(fourth.nextKind).toBeNull();
    expect(fourth.quota).toMatchObject({
      tier: 'free',
      limit: 3,
      used: 3,
      remaining: 0,
      nextPointsCost: 200,
      lifetimeLimit: 3,
      weeklyLimit: 0,
    });
  });

  it('PRO+：每周 3 次，同周第 4 次被拒；不再叠加终身的 3 次', () => {
    const window = quotaWeekWindow(SUNDAY);
    const pro = (weeklyUsed: number) =>
      computeRoleRequestQuota(
        facts(SUNDAY, { tier: 'pro_plus', weeklyUsed, lifetimeUsed: 0 }),
        window,
      );
    expect(pro(0).quota).toMatchObject({ limit: 3, used: 0, remaining: 3, weeklyLimit: 3 });
    expect(pro(2).quota).toMatchObject({ limit: 3, used: 2, remaining: 1, nextPointsCost: 0 });
    expect(pro(2).nextKind).toBe('weekly');

    // 同周第 4 次：不再有免费名额。
    const fourth = pro(3);
    expect(fourth.nextKind).toBeNull();
    expect(fourth.quota).toMatchObject({
      tier: 'pro_plus',
      limit: 3,
      used: 3,
      remaining: 0,
      nextPointsCost: 200,
    });

    // 旧规则「终身 3 + 每周 2」作废：终身次数已经用满也不影响 PRO+ 的每周额度。
    const withLifetimeUsed = computeRoleRequestQuota(
      facts(SUNDAY, { tier: 'pro_plus', weeklyUsed: 0, lifetimeUsed: 3 }),
      window,
    );
    expect(withLifetimeUsed.quota).toMatchObject({ limit: 3, remaining: 3, nextPointsCost: 0 });
    expect(withLifetimeUsed.nextKind).toBe('weekly');
  });

  it('跨周恢复：北京时间周一 0 点后本周次数清零，上周的 3 次不占新一周', () => {
    const sundayWindow = quotaWeekWindow(SUNDAY);
    const mondayWindow = quotaWeekWindow(MONDAY);
    expect(sundayWindow.start.toISOString()).toBe('2026-10-18T16:00:00.000Z'); // 10-19 00:00 +08
    expect(sundayWindow.end.toISOString()).toBe('2026-10-25T16:00:00.000Z'); // 10-26 00:00 +08
    expect(mondayWindow.start.toISOString()).toBe('2026-10-25T16:00:00.000Z');
    expect(mondayWindow.end.toISOString()).toBe('2026-11-01T16:00:00.000Z'); // 11-02 00:00 +08

    const used = [
      new Date('2026-10-19T00:00:00+08:00'), // 周一 0 点整算本周
      new Date('2026-10-23T12:00:00+08:00'),
      new Date('2026-10-25T23:59:59+08:00'), // 周日最后一秒仍算本周
    ];
    const beforeReset = computeRoleRequestQuota(
      facts(SUNDAY, { tier: 'pro_plus', weeklyUsed: weeklyUsedInWindow(used, sundayWindow) }),
      sundayWindow,
    );
    expect(beforeReset.nextKind).toBeNull();
    expect(beforeReset.quota.remaining).toBe(0);

    // 周一 0 点后：同一批申请落在上周窗口，本周从 3 次重新开始。
    expect(weeklyUsedInWindow(used, mondayWindow)).toBe(0);
    const afterReset = computeRoleRequestQuota(
      facts(MONDAY, { tier: 'pro_plus', weeklyUsed: weeklyUsedInWindow(used, mondayWindow) }),
      mondayWindow,
    );
    expect(afterReset.nextKind).toBe('weekly');
    expect(afterReset.quota).toMatchObject({ remaining: 3, nextPointsCost: 0 });
    expect(afterReset.quota.periodStart).toBe('2026-10-25T16:00:00.000Z');
  });

  it('免费用户的跨周行为不变：终身次数不会按周恢复', () => {
    const mondayWindow = quotaWeekWindow(MONDAY);
    const nextWeek = computeRoleRequestQuota(facts(MONDAY, { lifetimeUsed: 3 }), mondayWindow);
    expect(nextWeek.nextKind).toBeNull();
    expect(nextWeek.quota.remaining).toBe(0);
    expect(nextWeek.quota.nextPointsCost).toBe(200);
  });

  it('周期口径固定为北京时间，配置下调时 remaining 不会变成负数', () => {
    expect(QUOTA_TIME_ZONE).toBe('Asia/Shanghai');
    const window = quotaWeekWindow(SUNDAY);
    const beyond = computeRoleRequestQuota(
      facts(SUNDAY, { tier: 'pro_plus', weeklyUsed: 9 }),
      window,
    );
    expect(beyond.quota.remaining).toBe(0);
    expect(beyond.quota.used).toBe(3);
    expect(beyond.quota.timeZone).toBe('Asia/Shanghai');
  });
});
