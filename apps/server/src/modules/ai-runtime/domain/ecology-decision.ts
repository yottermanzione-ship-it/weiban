/**
 * 角色生态的「候选动作 → 做 / 不做 / 晚点做」纯规则（无数据库、无网络、不调模型）。
 *
 * 背景：总经理 2026-10-23 要求讲清「心跳、候选动作、决策模型」各自负责什么。
 * 这里固定三件事：
 *   1. 先由系统做**确定性**的硬性拦截（免打扰、每日上限、预算不足），这些不该交给模型去"悟"。
 *   2. 决策模型只在**过滤后的候选**里挑一个，或者明确返回"不做/晚点"。
 *   3. 模型给出的选择如果不在候选里、或超预算，一律按拒绝处理，不允许"模型说了就发"。
 *
 * 本模块不负责真正执行，也不负责计费冻结——执行前必须再核一次预算与频率。
 */

export type EcologyActionKind = 'chat_message' | 'moment_post' | 'moment_comment';

export interface EcologyCandidate {
  /** 调用方生成的稳定标识，用于让决策模型指认。 */
  id: string;
  kind: EcologyActionKind;
  /** 预估花费（微元）；0 表示平台内动作（如纯文本回复不额外收费时）。 */
  estimatedCostMicros: number;
  /** 越大越紧急，用于没有模型参与时的确定性兜底排序。 */
  urgency: number;
}

export interface EcologyContext {
  now: Date;
  /** 免打扰时段（本地小时，含起点不含终点）；跨零点用 start > end 表示。 */
  quietHours: { startHour: number; endHour: number } | null;
  /** 当前可用预算（微元）。 */
  budgetRemainingMicros: number;
  /** 今天已经主动发起的动作数。 */
  dailyActionCount: number;
  dailyActionLimit: number;
  /** 当地小时数（0–23），由调用方按用户时区算好。 */
  localHour: number;
}

/** 决策模型的回答：null 表示明确"现在不做"。 */
export interface EcologyModelChoice {
  candidateId: string | null;
  confidence: number;
}

export type EcologySkipReason =
  | 'no_candidates'
  | 'quiet_hours'
  | 'daily_limit_reached'
  | 'budget_exhausted'
  | 'model_declined'
  | 'model_choice_invalid'
  | 'model_low_confidence';

export type EcologyDecision =
  | { kind: 'act'; candidate: EcologyCandidate; reason: 'model_choice' | 'urgency_fallback' }
  | { kind: 'skip'; reason: EcologySkipReason };

const MIN_CONFIDENCE = 0.55;

function inQuietHours(ctx: EcologyContext): boolean {
  const quiet = ctx.quietHours;
  if (!quiet) return false;
  const { startHour, endHour } = quiet;
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) return false;
  if (startHour === endHour) return false;
  return startHour < endHour
    ? ctx.localHour >= startHour && ctx.localHour < endHour
    : ctx.localHour >= startHour || ctx.localHour < endHour;
}

/**
 * 决定这一刻要不要做一件事。
 * 硬性拦截优先于模型；模型只在剩余候选里挑，且不接受越界选择。
 */
export function decideEcologyAction(
  ctx: EcologyContext,
  candidates: readonly EcologyCandidate[],
  modelChoice?: EcologyModelChoice,
): EcologyDecision {
  if (inQuietHours(ctx)) return { kind: 'skip', reason: 'quiet_hours' };
  if (candidates.length === 0) return { kind: 'skip', reason: 'no_candidates' };
  if (ctx.dailyActionCount >= ctx.dailyActionLimit)
    return { kind: 'skip', reason: 'daily_limit_reached' };

  const affordable = candidates.filter(
    (candidate) => candidate.estimatedCostMicros <= ctx.budgetRemainingMicros,
  );
  if (affordable.length === 0) return { kind: 'skip', reason: 'budget_exhausted' };

  if (modelChoice) {
    if (modelChoice.candidateId === null) return { kind: 'skip', reason: 'model_declined' };
    if (!Number.isFinite(modelChoice.confidence) || modelChoice.confidence < MIN_CONFIDENCE)
      return { kind: 'skip', reason: 'model_low_confidence' };
    const chosen = affordable.find((candidate) => candidate.id === modelChoice.candidateId);
    // 模型指了一个不存在或超预算的动作：拒绝，而不是顺手换一个。
    if (!chosen) return { kind: 'skip', reason: 'model_choice_invalid' };
    return { kind: 'act', candidate: chosen, reason: 'model_choice' };
  }

  const fallback = [...affordable].sort(
    (a, b) => b.urgency - a.urgency || a.id.localeCompare(b.id),
  )[0]!;
  return { kind: 'act', candidate: fallback, reason: 'urgency_fallback' };
}
