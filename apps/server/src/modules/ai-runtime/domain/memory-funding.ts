import { nextLocalMidnight, PLATFORM_TIME_ZONE } from '../../../platform/time/local-time.js';

export function factJobKey(userId: string, conversationId: string, epoch: string) {
  return `facts:${userId}:${conversationId}:${epoch}`;
}

export type MemoryFundingBlock = 'insufficient_balance' | 'budget_exceeded';

export function memoryFailureCode(result: { error: string; message?: string }): string {
  return result.message === 'request_too_large' ||
    result.message === 'concurrency_limited' ||
    result.message === 'interrupted'
    ? result.message
    : result.error;
}

export function memoryOnHold(reason: string | null | undefined): boolean {
  return reason === 'insufficient_balance' || reason === 'interrupted';
}

export function isMemoryFundingBlock(reason: string): reason is MemoryFundingBlock {
  return reason === 'insufficient_balance' || reason === 'budget_exceeded';
}

/** A wallet timeout is a read-only funds check; only the billing gateway may authorize spend. */
export function memoryFundingCheckAt(reason: MemoryFundingBlock, now: Date): Date {
  return reason === 'budget_exceeded'
    ? nextLocalMidnight(now, PLATFORM_TIME_ZONE)
    : new Date(now.getTime() + 15 * 60_000);
}
