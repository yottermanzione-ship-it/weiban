/**
 * 10-25（会员 v6，总经理裁定）：角色制作免费次数的纯规则。
 *
 * - 免费用户：终身 `lifetimeFreeCount` 次（默认 3，不变）。
 * - PRO+：**每周 `proPlusWeeklyFreeCount` 次**（默认 3），北京时间周一 0 点重置、不累积。
 *   旧规则「终身 3 次 + PRO+ 每周 2 次」作废，不再叠加：PRO+ 只看本周还剩几次，
 *   免费额度用完后一律按 `pointsCost`（默认 200 积分/次）收费。
 * - 计数只算 pending / in_progress / completed（拒绝或撤回的申请退还次数，见 RoleRequestService 的
 *   QUOTA_COUNTED_STATUSES）；两类分开记在 role_requests.free_quota_kind，但 **PRO+ 的周计数不看类别**：
 *   本周计入的免费申请（含升级前用掉的终身名额）都占当周 3 次，避免同周叠加成 6 次。
 * - 升级 / 降档：升级到 PRO+ 当周按本周已用次数算（本周已用的 lifetime / weekly 都计数），
 *   降回免费后沿用原来的终身次数，不会因为会员期间用过 weekly 而减少终身次数。
 */
import type { RoleRequestQuota } from '@weiban/contracts';
import {
  PLATFORM_TIME_ZONE,
  addDays,
  localDate,
  localParts,
  startOfLocalDay,
} from '../../../platform/index.js';

/** 免费次数的周期口径：北京时间自然周（周一 0 点重置）。 */
export const QUOTA_TIME_ZONE = PLATFORM_TIME_ZONE;

export interface QuotaWeekWindow {
  /** 本周一 00:00（北京时间）对应的时刻。 */
  start: Date;
  /** 下周一 00:00（北京时间）对应的时刻，不含。 */
  end: Date;
}

/** 「现在」落在哪个北京自然周里。跨周后 start / end 前进 7 天，本周计数从 0 开始。 */
export function quotaWeekWindow(now: Date): QuotaWeekWindow {
  const date = localDate(now, QUOTA_TIME_ZONE);
  const weekStart = addDays(date, 1 - localParts(now, QUOTA_TIME_ZONE).weekday);
  return {
    start: startOfLocalDay(weekStart, QUOTA_TIME_ZONE),
    end: startOfLocalDay(addDays(weekStart, 7), QUOTA_TIME_ZONE),
  };
}

export interface RoleRequestQuotaFacts {
  tier: 'free' | 'pro_plus';
  /** 已占用的终身免费次数（免费用户口径：所有时间，kind = lifetime）。 */
  lifetimeUsed: number;
  /** 已占用的本周免费次数（PRO+ 口径：本周窗口内所有计入的免费申请，不区分 lifetime / weekly）。 */
  weeklyUsed: number;
  /** 配置：免费用户终身次数。 */
  lifetimeFreeCount: number;
  /** 配置：PRO+ 每周次数。 */
  proPlusWeeklyFreeCount: number;
  /** 配置：免费次数用完后每次的积分价格。 */
  pointsCost: number;
  /** 服务器统一核算时刻（契约 Membership.checkedAt，ISO 串）。 */
  quotedAt: string;
}

export interface RoleRequestQuotaDecision {
  quota: RoleRequestQuota;
  /** 下一次提交占哪一类免费次数；null = 免费次数已用完，本次按 pointsCost 收费。 */
  nextKind: 'weekly' | 'lifetime' | null;
}

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * 算当前档位的有效额度与本次报价。
 * limit / used / remaining 只反映**当前档位真正生效的那一类**：免费 = 终身，PRO+ = 本周。
 * lifetime* / weekly* 仍分别返回原始事实，方便客户端说明「免费 3 次 / PRO+ 每周 3 次」。
 */
export function computeRoleRequestQuota(
  facts: RoleRequestQuotaFacts,
  window: QuotaWeekWindow,
): RoleRequestQuotaDecision {
  const pro = facts.tier === 'pro_plus';
  const lifetimeLimit = whole(facts.lifetimeFreeCount);
  const lifetimeUsed = whole(facts.lifetimeUsed);
  const weeklyLimit = pro ? whole(facts.proPlusWeeklyFreeCount) : 0;
  const weeklyUsed = pro ? whole(facts.weeklyUsed) : 0;
  const lifetimeLeft = Math.max(0, lifetimeLimit - lifetimeUsed);
  const weeklyLeft = Math.max(0, weeklyLimit - weeklyUsed);
  // 不再「终身 + 每周」叠加：PRO+ 只用每周次数，免费用户只用终身次数。
  const nextKind: RoleRequestQuotaDecision['nextKind'] = pro
    ? weeklyLeft > 0
      ? 'weekly'
      : null
    : lifetimeLeft > 0
      ? 'lifetime'
      : null;
  const limit = pro ? weeklyLimit : lifetimeLimit;
  const used = pro ? Math.min(weeklyUsed, weeklyLimit) : Math.min(lifetimeUsed, lifetimeLimit);
  return {
    nextKind,
    quota: {
      quotedAt: facts.quotedAt,
      tier: facts.tier,
      limit,
      used,
      remaining: pro ? weeklyLeft : lifetimeLeft,
      nextPointsCost: nextKind ? 0 : whole(facts.pointsCost),
      lifetimeLimit,
      lifetimeUsed,
      weeklyLimit,
      weeklyUsed,
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      timeZone: QUOTA_TIME_ZONE,
    },
  };
}
