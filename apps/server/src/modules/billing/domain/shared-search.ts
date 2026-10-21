/** Integer micro-yuan only. 1 point = 10000 micros, 0.01 point = 100 micros. */
export const SHARED_SEARCH_PURPOSE = 'weibo_shared_search';
export function sharedSlice(total: number, count: number, ordinal: number, offset = 0): number {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= count
  )
    throw new Error('invalid shared allocation');
  const amount = BigInt(total),
    n = BigInt(count);
  return Number(amount / n + (BigInt((ordinal - offset + count) % count) < amount % n ? 1n : 0n));
}
/** Accumulate less than one cent-point; round only once at least 0.01 point is due. */
export function roundedSharedCharge(share: number, carry: number) {
  if (
    !Number.isSafeInteger(share) ||
    share < 0 ||
    !Number.isInteger(carry) ||
    carry < -50 ||
    carry > 99
  )
    throw new Error('invalid shared carry');
  const due = BigInt(share) + BigInt(carry);
  const charge = due < 100n ? 0n : ((due + 50n) / 100n) * 100n;
  if (charge > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('shared charge overflow');
  return { charge: Number(charge), carry: Number(due - charge) };
}
