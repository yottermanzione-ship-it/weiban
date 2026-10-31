/**
 * 生态三线分账的纯规则（对照表 v3 第 9、10、25、26、28 项；多样性草案 §3）。
 *
 * 三条线各记各的账，绝不共用一个「未回复次数」字段：
 * - 主线：生态聊天类动作（message / voice / photo / sticker / nudge / share_link / play_wish）
 *   在用户最后一条消息之后成功执行的次数。满 3 次停发主线。
 * - 久未问候（care_absence）：主线之外的 +1。主线满 3 次后、72 小时无互动时仍可发一次，
 *   发过一次就不再发；它不计入主线次数。
 * - 单独线（greeting / care_anniversary / care_follow_up / care_late_night / care_period）：
 *   各自按自己的字段计数（当天是否发过 / 事项状态），永远不计入主线，也不影响 3 天判定。
 * - 3 天自动关：只看「最后一次用户消息时间」满 72 小时且主线已满 3 次。
 *
 * 主线次数的来源是 ecology_runs 里已成功的行（按 actionKey 区分），不是聊天条数：
 * 早安晚安、跟进等单独线发出的消息同样会出现在聊天记录里，按聊天条数算会把三线串起来。
 * 用户回任何消息（包括回早安晚安、回跟进）都会产生新的最后用户消息时间，主线计数随之清零。
 */
import type { EcologyActionKey } from '@weiban/contracts';

/** 计入主线未回复次数的动作：只有这些动作的成功执行会让主线 +1。 */
export const MAIN_LINE_ACTIONS: ReadonlySet<EcologyActionKey> = new Set([
  'message',
  'voice',
  'photo',
  'sticker',
  'nudge',
  'share_link',
  'play_wish',
]);

/** 单独线的动作：发了只记自己的账，绝不计入主线。 */
export const SEPARATE_LINE_ACTIONS: ReadonlySet<EcologyActionKey> = new Set([
  'greeting',
  'care_anniversary',
  'care_follow_up',
  'care_late_night',
  'care_period',
]);

/** 主线未回复达到这个数就停发主线（对照表 v3：3 次）。 */
export const MAIN_UNREPLIED_LIMIT = 3;
/** 无用户互动满这么久，且主线已满，就自动关掉该角色生态。 */
export const AUTO_OFF_SILENCE_MS = 72 * 3600_000;

export interface EcologyRunCount {
  actionKey: string | null;
  /** 完成时间（毫秒时间戳）。 */
  finishedAtMs: number | null;
  /** 当地日期（Asia/Shanghai 口径由调用方按用户时区算好传进来）。 */
  localDate: string;
  /** 完成时的当地小时（0–23），用于区分早安 / 晚安窗口。 */
  localHour: number | null;
}

/**
 * 主线未回复次数：最后一条用户消息之后，主线动作成功执行的行数。
 * lastUserAtMs 为 null（从无用户消息）时计全部行数。
 */
export function countMainUnreplied(
  runs: readonly EcologyRunCount[],
  lastUserAtMs: number | null,
): number {
  let count = 0;
  for (const run of runs) {
    if (!run.actionKey || !MAIN_LINE_ACTIONS.has(run.actionKey as EcologyActionKey)) continue;
    if (run.finishedAtMs === null) continue;
    if (lastUserAtMs !== null && run.finishedAtMs <= lastUserAtMs) continue;
    count++;
  }
  return count;
}

/** 最后一条用户消息之后，久未问候（care_absence）是否已经发过（+1 已用掉）。 */
export function absenceGreetedSince(
  runs: readonly EcologyRunCount[],
  lastUserAtMs: number | null,
): boolean {
  return runs.some(
    (run) =>
      run.actionKey === 'care_absence' &&
      run.finishedAtMs !== null &&
      (lastUserAtMs === null || run.finishedAtMs > lastUserAtMs),
  );
}

/** 今天早安 / 晚安是否已发过（各记各的）。晚安窗口跨午夜：同一天 0–1 点的晚安也算今天已发过，避免凌晨连发两次。 */
export function greetingDone(
  runs: readonly EcologyRunCount[],
  today: string,
): { morningDone: boolean; eveningDone: boolean } {
  let morningDone = false;
  let eveningDone = false;
  for (const run of runs) {
    if (run.actionKey !== 'greeting' || run.localHour === null || run.localDate !== today) continue;
    if (run.localHour >= 6 && run.localHour < 10) morningDone = true;
    if (run.localHour >= 21 || run.localHour < 1) eveningDone = true;
  }
  return { morningDone, eveningDone };
}

/** 某单独线动作今天是否已成功执行过（生日 / 纪念日、深夜催睡各记各的）。 */
export function separateLineDoneToday(
  runs: readonly EcologyRunCount[],
  action: EcologyActionKey,
  today: string,
): boolean {
  return runs.some((run) => run.actionKey === action && run.localDate === today);
}

/**
 * 3 天自动关判定：只看最后用户消息时间 + 主线次数。
 * 单独线发了多少、跟进问了多少，都不影响这个判定。
 */
export function shouldAutoOff(input: {
  nowMs: number;
  lastUserAtMs: number | null;
  mainUnreplied: number;
}): boolean {
  if (input.lastUserAtMs === null) return false;
  return (
    input.nowMs - input.lastUserAtMs >= AUTO_OFF_SILENCE_MS &&
    input.mainUnreplied >= MAIN_UNREPLIED_LIMIT
  );
}

/**
 * 聊天类候选是否还能进候选（只看计数线，不看时间窗、模型等其他条件）。
 * - 主线动作：满 3 次就挡。
 * - care_absence：主线满 3 次后仍可作为 +1 发一次；已发过就挡；主线未满时也不挡（由 Jev 决定）。
 * - 单独线：永远不被主线次数挡。
 * - 非聊天动作：不挡。
 */
export function chatActionCountAllowed(
  action: EcologyActionKey,
  counts: { mainUnreplied: number; absenceGreeted: boolean },
): boolean {
  if (action === 'care_absence') return !counts.absenceGreeted;
  if (SEPARATE_LINE_ACTIONS.has(action)) return true;
  if (MAIN_LINE_ACTIONS.has(action)) return counts.mainUnreplied < MAIN_UNREPLIED_LIMIT;
  return true;
}
