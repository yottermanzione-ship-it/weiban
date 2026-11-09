import {
  isLegacyMigrationOwnerPreserved,
  assertLegacyMigrationOwnerAllowed,
} from '../../scripts/ops/fast-cutover-owners.mjs';
export const allowedRelayExclusions = new Set([
  'preserved_existing_account',
  'native_binding_conflict',
  'manager_skip_weibo',
  'membership_expired',
]);
export function relayScopeExclusion(
  row,
  proPlusUntil,
  preserved = isLegacyMigrationOwnerPreserved,
) {
  if (row.channel === 'weibo') return 'manager_skip_weibo';
  if (preserved(row.userId)) return 'preserved_existing_account';
  if (
    row.channel === 'wechat' &&
    !(new Date(proPlusUntil ?? NaN).getTime() > Date.parse(row.cutoverAt))
  )
    return 'membership_expired';
  return null;
}
export function assertRelayChannel(row) {
  if (!['wechat', 'qq'].includes(row.channel)) throw new Error('RELAY_CHANNEL_NOT_AUTHORIZED');
  assertLegacyMigrationOwnerAllowed(row.userId);
}
export async function assertRelayScope(tx, row) {
  assertRelayChannel(row);
  if (row.channel !== 'wechat') return;
  const result = await tx.query(
    'SELECT pro_plus_until FROM identity.memberships WHERE user_id=$1 FOR SHARE',
    [row.userId],
  );
  if (relayScopeExclusion(row, result.rows[0]?.pro_plus_until))
    throw new Error('RELAY_MEMBERSHIP_EXPIRED');
}
