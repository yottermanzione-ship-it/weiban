import type { Message } from '@weiban/contracts';

/** Retain a tail after adoption. While a summary is pending, keep at most one 32-message window. */
export const RECENT_CHAT_KEEP = 8;
export const RECENT_CHAT_LIMIT = 32;
export function recentSummaryCutoff(
  pending: readonly Message[],
  pendingTokens: number,
  hasGap: boolean,
): number | null {
  if (pending.length <= RECENT_CHAT_KEEP) return null;
  if (
    !hasGap &&
    pending.length < RECENT_CHAT_LIMIT &&
    pending.filter((m) => m.senderKind === 'user').length < 16 &&
    pendingTokens < 11200
  )
    return null;
  return pending[pending.length - RECENT_CHAT_KEEP - 1]!.seq;
}
