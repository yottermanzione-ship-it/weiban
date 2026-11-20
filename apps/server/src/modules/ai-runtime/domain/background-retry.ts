import { nextLocalMidnight } from '../../../platform/index.js';

const TICK_MS = 10 * 60_000;
export const BACKGROUND_FRESHNESS_MS = 60 * 60_000;

/** Each owner keeps the original task, a short useful window and at most two additional attempts. */
export function backgroundRetry(
  reason: string,
  count: number,
  now: Date,
  expires: Date,
): { retryAt: Date | null } | null {
  if (count >= 2 || now >= expires) return null;
  if (reason === 'insufficient_balance') return { retryAt: null };
  const retryAt =
    reason === 'budget_exceeded'
      ? nextLocalMidnight(now, 'Asia/Shanghai')
      : ['concurrency_limited', 'insufficient_fallback_time', 'timeout_deadline'].includes(reason)
        ? new Date(now.getTime() + TICK_MS * (count + 1))
        : null;
  return retryAt && retryAt < expires ? { retryAt } : null;
}

export function retrySuffix(count: number) {
  return count ? ':retry:' + count : '';
}
