/**
 * 朋友圈点赞 / 评论分开排期的纯规则（对照表 v3 §4，照抄旧版机制）。
 *
 * 旧版机制（生产 lib/moments/moments_service.js 已核实）：
 * - 用户发动态 → 最多 4 个可见角色排期；点赞几乎总是排，评论最多 2 个、45% 概率；
 *   延迟 1–15 分钟；点赞和评论是分开的任务、各自去重。
 * - 角色发公开动态 → 最多 5 个其他角色排期；点赞前 2 个几乎总是、其余 45%，
 *   评论最多 1 个、35% 概率；延迟 1–15 分钟。
 * - 用户评论角色动态 → 被回复的角色排一个回复任务（必回，另见 onCommentCreated，不在这里）。
 *
 * 本文件只算「谁点赞、谁评论」；延迟与去重键由调用方（moments-ai）按返回结果排任务。
 * 点赞任务与评论任务分开：同一角色可以只点赞、只评论、或两者都做；两个任务互不挡。
 * 概率用调用方传入的抽签值（0–1），便于测试与稳定复现；不由本文件掷骰子。
 */
export interface MomentsReactionCandidate {
  characterId: string;
  /** 用户动态：熟悉度等级（1–5），按熟悉度从高到低排好传进来。 */
  familiarityLevel?: number;
  /** 点赞抽签（0–1），越小越可能点赞。 */
  likeDraw: number;
  /** 评论抽签（0–1），越小越可能评论。 */
  commentDraw: number;
}

export interface PlannedMomentsReaction {
  characterId: string;
  like: boolean;
  comment: boolean;
}

/** 「几乎总是」：旧版「点赞几乎总是排期」的抽签阈值。 */
export const MOMENTS_LIKE_ALMOST_ALWAYS = 0.95;
/** 朋友圈互动延迟：旧版 1–15 分钟（毫秒）。 */
export const MOMENTS_REACT_DELAY_MIN_MS = 60_000;
export const MOMENTS_REACT_DELAY_MAX_MS = 15 * 60_000;

/** 用户动态的点赞概率：熟悉度越高越可能点（与现行 fam 曲线一致：L1 0.15 … L5 0.9）。 */
export function userPostLikeProbability(familiarityLevel: number): number {
  const p = [0, 0.15, 0.45, 0.65, 0.8, 0.9][Math.max(0, Math.min(5, familiarityLevel))] ?? 0.15;
  return Math.min(1, p + 0.2);
}

/**
 * 用户发动态：最多 4 个角色；点赞按熟悉度概率（几乎总是），评论最多 2 个、45%。
 * 候选须已按熟悉度从高到低排好（评论名额先给熟悉度高的）。
 */
export function planUserPostReactions(
  candidates: readonly MomentsReactionCandidate[],
  maxCharacters = 4,
  maxComments = 2,
  commentProbability = 0.45,
): PlannedMomentsReaction[] {
  const out: PlannedMomentsReaction[] = [];
  let comments = 0;
  for (const c of candidates.slice(0, maxCharacters)) {
    const like = c.likeDraw < userPostLikeProbability(c.familiarityLevel ?? 1);
    const comment = comments < maxComments && c.commentDraw < commentProbability;
    if (comment) comments++;
    if (like || comment) out.push({ characterId: c.characterId, like, comment });
  }
  return out;
}

/**
 * 角色发动态：最多 5 个其他角色；点赞前 2 个几乎总是、其余 45%，评论最多 1 个、35%。
 * 候选须已按关系亲疏排好（前 2 个是关系最近的）。
 */
export function planPeerPostReactions(
  candidates: readonly MomentsReactionCandidate[],
  maxCharacters = 5,
  maxComments = 1,
  commentProbability = 0.35,
): PlannedMomentsReaction[] {
  const out: PlannedMomentsReaction[] = [];
  let comments = 0;
  candidates.slice(0, maxCharacters).forEach((c, index) => {
    const like = c.likeDraw < (index < 2 ? MOMENTS_LIKE_ALMOST_ALWAYS : 0.45);
    const comment = comments < maxComments && c.commentDraw < commentProbability;
    if (comment) comments++;
    if (like || comment) out.push({ characterId: c.characterId, like, comment });
  });
  return out;
}

/** 1–15 分钟内的延迟（毫秒）：调用方用独立抽签分别算点赞任务与评论任务的延迟。 */
export function momentsReactDelayMs(draw: number): number {
  const clamped = Math.max(0, Math.min(1, draw));
  return Math.floor(
    MOMENTS_REACT_DELAY_MIN_MS +
      clamped * (MOMENTS_REACT_DELAY_MAX_MS - MOMENTS_REACT_DELAY_MIN_MS),
  );
}
