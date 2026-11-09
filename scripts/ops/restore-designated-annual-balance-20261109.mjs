/** Explicit, single-account exception. No automatic connection or execution. */
import { createHash } from 'node:crypto';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
import { legacyId } from './legacy-content-rules.mjs';

export async function restoreDesignatedAnnualBalance({
  database,
  ledger,
  confirmedIdentityDigest,
  execute = false,
}) {
  const [targetDigest] = policy.userIdSha256;
  if (policy.userIdSha256.length !== 1 || confirmedIdentityDigest !== targetDigest)
    throw new Error('ANNUAL_IDENTITY_CONFIRMATION_REQUIRED');
  return database.transaction(async (tx) => {
    if (!execute) await tx.query('SET TRANSACTION READ ONLY');
    const users = (
      await tx.query(
        "SELECT id,status FROM identity.users WHERE encode(sha256(convert_to('user:'||id::text,'UTF8')),'hex')=$1" +
          (execute ? ' FOR UPDATE' : ''),
        [targetDigest],
      )
    ).rows;
    if (users.length !== 1 || users[0].status !== 'active')
      throw new Error('ANNUAL_TARGET_NOT_UNIQUE_ACTIVE');
    const userId = users[0].id;
    if (
      createHash('sha256')
        .update('user:' + userId)
        .digest('hex') !== targetDigest
    )
      throw new Error('ANNUAL_IDENTITY_MISMATCH');
    const receiptId = legacyId('annual-restore-receipt', 'migration-20261109', userId);
    const prior = (
      await tx.query(
        "SELECT id FROM platform.audit_log WHERE id=$1 AND action='migration.annual_balance_restored'",
        [receiptId],
      )
    ).rows;
    if (prior.length) return { status: 'already_applied', changed: false };
    const orders = (
      await tx.query(
        `SELECT o.id,o.bonus_points,l.amount_micros FROM billing.membership_orders o JOIN billing.ledger_entries l ON l.id=o.ledger_entry_id JOIN billing.accounts a ON a.id=l.account_id AND a.user_id=o.user_id WHERE o.user_id=$1 AND o.plan_id='year' AND o.price_fen=19800 AND o.bonus_points=24000 AND l.amount_micros=240000000 ORDER BY o.created_at`,
        [userId],
      )
    ).rows;
    if (orders.length !== 1) throw new Error('ANNUAL_ORIGINAL_ORDER_REQUIRES_REVIEW');
    const wallet = (
      await tx.query(
        "SELECT id,balance_micros,held_micros FROM billing.accounts WHERE user_id=$1 AND kind='user'" +
          (execute ? ' FOR UPDATE' : ''),
        [userId],
      )
    ).rows[0];
    if (
      !wallet ||
      !Number.isSafeInteger(Number(wallet.balance_micros)) ||
      Number(wallet.held_micros) !== 0
    )
      throw new Error('ANNUAL_WALLET_NOT_SETTLED');
    const unsettled = (
      await tx.query(
        "SELECT count(*)::int AS n FROM billing.holds WHERE account_id=$1 AND status='active'",
        [wallet.id],
      )
    ).rows[0].n;
    if (unsettled !== 0) throw new Error('ANNUAL_USAGE_STILL_ACTIVE');
    const targetMicros = orders[0].bonus_points * 10000;
    const amountMicros = Math.max(0, targetMicros - Number(wallet.balance_micros));
    const summary = {
      status: execute ? 'applied' : 'planned',
      beforePoints: Number(wallet.balance_micros) / 10000,
      targetPoints: targetMicros / 10000,
      addedPoints: amountMicros / 10000,
      changed: execute && amountMicros > 0,
    };
    if (!execute) return summary;
    const key = 'migration-20261109:annual-restore:' + userId;
    if (await ledger.findByIdempotencyKey(tx, key))
      throw new Error('ANNUAL_RECEIPT_INCOMPLETE_REQUIRES_REVIEW');
    if (amountMicros > 0) {
      const locked = await ledger.lockUserAccount(tx, userId);
      if (locked.balanceMicros !== Number(wallet.balance_micros) || locked.heldMicros !== 0)
        throw new Error('ANNUAL_BALANCE_CHANGED');
      await ledger.postEntry(tx, locked, {
        type: 'admin_grant',
        amountMicros,
        idempotencyKey: key,
        purpose: 'annual_points_restore',
        reason: '按原198元年卡订单恢复至24000积分',
        bonusCredit: true,
      });
    }
    await tx.query(
      "INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,target_type,target_id,details) VALUES($1,now(),'billing','migration.annual_balance_restored','system','user',$2,$3::jsonb)",
      [
        receiptId,
        userId,
        JSON.stringify({
          originalOrderId: orders[0].id,
          targetPoints: 24000,
          addedMicros: amountMicros,
          beforeMicros: Number(wallet.balance_micros),
        }),
      ],
    );
    return summary;
  });
}
