/** Candidate only: explicitly reconciled, uncredited legacy benefits. No inferred compensation. */
import { fingerprint, invariant, utc } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import { legacyId } from './legacy-content-rules.mjs';

export async function readEntitlementBaseline(database, userId) {
  const result = await database.query(
    'SELECT user_id,pro_plus_until,granted_by,updated_at FROM identity.memberships WHERE user_id=$1',
    [userId],
  );
  return result.rows[0] ?? null;
}

export function planEntitlementDelta({
  userId,
  targetBaseline,
  sourceEvents,
  appliedReceipts = [],
  originalCutoff,
  finalCutoff,
  decisionId,
}) {
  invariant(
    Array.isArray(sourceEvents) && Array.isArray(appliedReceipts),
    'ENTITLEMENT_EVENT_LIST_REQUIRED',
  );
  const before = utc(originalCutoff),
    cutoff = utc(finalCutoff);
  invariant(before < cutoff, 'ENTITLEMENT_WINDOW_REQUIRED');
  invariant(/^synthetic-[a-z0-9-]+$/u.test(decisionId ?? ''), 'SYNTHETIC_REVIEW_DECISION_REQUIRED');
  const conflicts = [],
    planned = [],
    duplicate = [],
    seen = new Map();
  const applied = new Map(appliedReceipts.map((row) => [row.event_key, row]));
  for (const event of sourceEvents) {
    const eventKey = fingerprint(['legacy-weiban-membership', event.sourceEventId]);
    const eventDigest = fingerprint(event);
    const conflict = (reason) => conflicts.push({ eventKey, reason });
    if (typeof event.sourceEventId !== 'string' || !event.sourceEventId.trim()) {
      conflict('SOURCE_EVENT_ID_REQUIRED');
      continue;
    }
    if (seen.has(eventKey)) {
      if (seen.get(eventKey) !== eventDigest) conflict('SOURCE_EVENT_CONFLICT');
      else duplicate.push(eventKey);
      continue;
    }
    seen.set(eventKey, eventDigest);
    if (
      event.userId !== userId ||
      event.kind !== 'paid_membership_renewal' ||
      event.benefit !== 'pro_plus'
    ) {
      conflict('UNSUPPORTED_EVENT_OR_OWNER');
      continue;
    }
    const receipt = applied.get(eventKey);
    if (receipt) {
      if (receipt.user_id !== userId || receipt.event_digest !== eventDigest)
        conflict('APPLIED_EVENT_CHANGED');
      else duplicate.push(eventKey);
      continue;
    }
    let paidAt, startsAt, endsAt;
    try {
      paidAt = utc(event.paidAt);
      startsAt = utc(event.sourceBenefitStartsAt);
      endsAt = utc(event.sourceBenefitEndsAt);
    } catch {
      conflict('SOURCE_EVENT_TIME_UNVERIFIED');
      continue;
    }
    if (!(paidAt > before && paidAt <= cutoff && startsAt < endsAt)) {
      conflict('EVENT_OUTSIDE_REVIEW_WINDOW');
      continue;
    }
    if (
      event.paymentStatus !== 'settled' ||
      event.refundStatus !== 'none' ||
      event.disputeStatus !== 'none'
    ) {
      conflict('REFUND_DISPUTE_OR_PAYMENT_REVIEW_REQUIRED');
      continue;
    }
    const proof = event.reconciliation;
    if (
      !proof ||
      proof.paymentVerified !== true ||
      proof.ownershipVerified !== true ||
      proof.excludedFromOriginalImport !== true ||
      proof.notCreditedOnNewSite !== true ||
      proof.unusedBenefitVerified !== true ||
      proof.decisionId !== decisionId
    ) {
      conflict('EXPLICIT_UNCREDITED_BENEFIT_RECONCILIATION_REQUIRED');
      continue;
    }
    const milliseconds = proof.approvedUncreditedMilliseconds;
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds <= 0 ||
      milliseconds > Date.parse(endsAt) - Date.parse(startsAt)
    ) {
      conflict('REVIEWED_DURATION_INVALID');
      continue;
    }
    planned.push({ eventKey, eventDigest, milliseconds });
  }
  let milliseconds = 0;
  for (const event of planned) {
    milliseconds += event.milliseconds;
    invariant(Number.isSafeInteger(milliseconds), 'ENTITLEMENT_DURATION_OVERFLOW');
  }
  const oldUntil = targetBaseline?.pro_plus_until ? utc(targetBaseline.pro_plus_until) : null;
  // This is the retained NEW-site entitlement, not max(old-site expiry, new-site expiry).
  const start = Math.max(Date.parse(cutoff), oldUntil ? Date.parse(oldUntil) : 0);
  const end = new Date(start + milliseconds);
  invariant(Number.isFinite(end.getTime()), 'ENTITLEMENT_EXPIRY_OVERFLOW');
  const payload = {
    policy: 'candidate-reviewed-uncredited-duration-v1',
    synthetic: true,
    userId,
    baseline: fingerprint(targetBaseline),
    originalCutoff: before,
    finalCutoff: cutoff,
    decisionId,
    previousUntil: oldUntil,
    nextUntil: planned.length ? end.toISOString() : oldUntil,
    approvedMilliseconds: milliseconds,
    events: planned,
    duplicateEvents: duplicate.length,
    conflicts,
  };
  return { ...payload, digest: fingerprint(payload) };
}

/** Fixture schema only. Production migration schema/approval is deliberately absent. */
export async function initializeEntitlementFixture(database, target) {
  await assertFixtureDatabase(database, target);
  await database.query(`CREATE TABLE IF NOT EXISTS public.codex_migration_entitlement_receipts (
    event_key text PRIMARY KEY, user_id uuid NOT NULL, event_digest text NOT NULL,
    credited_ms bigint NOT NULL CHECK(credited_ms>0), plan_digest text NOT NULL,
    previous_until timestamptz, next_until timestamptz NOT NULL)`);
}

export async function applyEntitlementDelta({ database, target, plan, maintenance, fault }) {
  await assertFixtureDatabase(database, target);
  invariant(
    maintenance?.writersStopped === true && maintenance?.notificationsCaptured === true,
    'MAINTENANCE_REQUIRED',
  );
  const { digest, ...payload } = plan;
  invariant(
    digest === fingerprint(payload) && plan.synthetic === true,
    'ENTITLEMENT_PLAN_DIGEST_MISMATCH',
  );
  invariant(plan.conflicts.length === 0, 'ENTITLEMENT_PLAN_REQUIRES_REVIEW');
  return database.transaction(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('migration-entitlement:' || $1,0))",
      [plan.userId],
    );
    const owner = await tx.query('SELECT status FROM identity.users WHERE id=$1 FOR UPDATE', [
      plan.userId,
    ]);
    invariant(
      owner.rows.length === 1 && owner.rows[0].status === 'active',
      'ENTITLEMENT_OWNER_NOT_ACTIVE',
    );
    const previous = await tx.query(
      'SELECT * FROM public.codex_migration_entitlement_receipts WHERE event_key=ANY($1::text[])',
      [plan.events.map((event) => event.eventKey)],
    );
    for (const receipt of previous.rows) {
      const event = plan.events.find((entry) => entry.eventKey === receipt.event_key);
      invariant(
        receipt.user_id === plan.userId &&
          receipt.event_digest === event.eventDigest &&
          Number(receipt.credited_ms) === event.milliseconds,
        'ENTITLEMENT_EVENT_ALREADY_APPLIED_DIFFERENTLY',
      );
    }
    if (previous.rows.length === plan.events.length)
      return { status: 'already_applied', events: 0 };
    invariant(previous.rows.length === 0, 'PARTIAL_ENTITLEMENT_PLAN_REQUIRES_REPLAN');
    const baseline = await readEntitlementBaseline(tx, plan.userId);
    invariant(
      fingerprint(baseline) === plan.baseline,
      'ENTITLEMENT_TARGET_CHANGED_REPLAN_REQUIRED',
    );
    await tx.query(
      `INSERT INTO identity.memberships(user_id,pro_plus_until,granted_by,updated_at)
      VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET pro_plus_until=EXCLUDED.pro_plus_until,
      updated_at=EXCLUDED.updated_at`,
      [plan.userId, plan.nextUntil, baseline?.granted_by ?? null, plan.finalCutoff],
    );
    if (fault === 'after-membership') throw new Error('SYNTHETIC_ENTITLEMENT_INTERRUPTION');
    for (const event of plan.events) {
      await tx.query(
        `INSERT INTO public.codex_migration_entitlement_receipts
        (event_key,user_id,event_digest,credited_ms,plan_digest,previous_until,next_until)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          event.eventKey,
          plan.userId,
          event.eventDigest,
          event.milliseconds,
          digest,
          plan.previousUntil,
          plan.nextUntil,
        ],
      );
    }
    await tx.query(
      `INSERT INTO identity.membership_changes
      (id,user_id,previous_until,new_until,operator_user_id,reason,created_at) VALUES($1,$2,$3,$4,NULL,$5,$6)`,
      [
        legacyId('synthetic-entitlement-change', digest),
        plan.userId,
        plan.previousUntil,
        plan.nextUntil,
        `synthetic_legacy_event_delta:${digest}`,
        plan.finalCutoff,
      ],
    );
    return {
      status: 'applied',
      events: plan.events.length,
      creditedMilliseconds: plan.approvedMilliseconds,
    };
  });
}
