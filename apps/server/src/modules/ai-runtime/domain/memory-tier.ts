/**
 * 记忆分档（v5 批 B，docs/refactor/16-membership-v5.md §5.3/§5.4）。纯函数与默认值。
 * 参数后台可调（MemoryTierEndpoints.adminUpdate），这里只是没配置时的默认。
 */
import { MemoryTierConfig, type MemoryTierLimits } from '@weiban/contracts';

export const DEFAULT_MEMORY_TIER_CONFIG: MemoryTierConfig = {
  free: { residentLimit: 3, libraryLimit: 30, summaryDays: 7, retrieveLimit: 3, recallDays: 7 },
  proPlus: {
    residentLimit: 16,
    libraryLimit: null,
    summaryDays: null,
    retrieveLimit: 8,
    recallDays: null,
  },
  newUserTrialDays: 7,
  recallTopK: 3,
  groupMemoryMessageThreshold: 20,
  groupMemoryIdleMinutes: 10,
};

/** 读库里的配置：缺字段 / 旧格式按默认补齐，坏数据整份回落默认，不让一次误填拖垮回复。 */
export function normalizeTierConfig(raw: unknown): MemoryTierConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_MEMORY_TIER_CONFIG;
  // 2026-10-25：「长上下文模式」下线，旧配置里残留的 longContext 不再参与，读库时丢弃
  // （strict 校验遇到不认识的字段会整份回落默认，等于丢掉所有已配置的档位）。
  const { longContext: _legacyLongContext, ...rest } = raw as Record<string, unknown>;
  const r = rest as Partial<Record<keyof MemoryTierConfig, unknown>>;
  const merged = {
    ...DEFAULT_MEMORY_TIER_CONFIG,
    ...r,
    free: { ...DEFAULT_MEMORY_TIER_CONFIG.free, ...(r.free as object | undefined) },
    proPlus: { ...DEFAULT_MEMORY_TIER_CONFIG.proPlus, ...(r.proPlus as object | undefined) },
  };
  const parsed = MemoryTierConfig.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_MEMORY_TIER_CONFIG;
}

export interface ResolvedMemoryTier {
  tier: 'free' | 'pro_plus';
  basis: 'member' | 'new_user' | 'free';
  /** 是否 PRO+ 会员（会员专属能力只认这个，新用户体验不算）。 */
  member: boolean;
  trialEndsAt: string | null;
  limits: MemoryTierLimits;
  config: MemoryTierConfig;
}

export function resolveTier(input: {
  member: boolean;
  registeredAt: Date | null;
  now: Date;
  config: MemoryTierConfig;
}): ResolvedMemoryTier {
  const { config } = input;
  if (input.member)
    return {
      tier: 'pro_plus',
      basis: 'member',
      member: true,
      trialEndsAt: null,
      limits: config.proPlus,
      config,
    };
  const trialEnd =
    input.registeredAt && config.newUserTrialDays > 0
      ? new Date(input.registeredAt.getTime() + config.newUserTrialDays * 86_400_000)
      : null;
  if (trialEnd && trialEnd > input.now)
    return {
      tier: 'pro_plus',
      basis: 'new_user',
      member: false,
      trialEndsAt: trialEnd.toISOString(),
      limits: config.proPlus,
      config,
    };
  return {
    tier: 'free',
    basis: 'free',
    member: false,
    trialEndsAt: null,
    limits: config.free,
    config,
  };
}

/** N 天前的日期（YYYY-MM-DD，UTC，和摘要片段 / 日摘要的日期口径一致）；null = 不限。 */
export function sinceDay(now: Date, days: number | null): string | null {
  if (days === null) return null;
  return new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** 稳定记忆块的档位指纹：档位参数变了块要重算（档位很少变，不影响平时缓存命中）。 */
export function tierFingerprint(limits: MemoryTierLimits, summarySince: string | null): string {
  return [
    limits.residentLimit,
    limits.libraryLimit ?? 'all',
    limits.summaryDays ?? 'all',
    summarySince ?? 'all',
  ].join(':');
}
