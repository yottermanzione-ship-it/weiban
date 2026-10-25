/** Integer micro-yuan only. 1 point = 10000 micros, 0.01 point = 100 micros. */
export const SHARED_SEARCH_PURPOSE = 'weibo_shared_search';

/**
 * 3.29：结算前把成员收敛到「重核后仍合格」的集合。
 * 不传 eligible = 沿用旧行为；传空数组 = 本次不向任何用户收款（平台承担），
 * 绝不把剩余用户的费用集中压给某一个残留成员。
 */
export function eligibleMembers<T extends { user_id: string }>(
  members: readonly T[],
  eligibleUserIds?: readonly string[],
): T[] {
  if (!eligibleUserIds) return [...members];
  const allowed = new Set(eligibleUserIds);
  return members.filter((member) => allowed.has(member.user_id));
}

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
