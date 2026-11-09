import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEntitlementDelta } from './legacy-delta-entitlements.mjs';

const userId = '10000000-0000-4000-8000-000000000001';
const decisionId = 'synthetic-reviewed-entitlement';
const targetBaseline = {
  user_id: userId,
  pro_plus_until: '2027-02-01T00:00:00.000Z',
  granted_by: null,
  updated_at: '2026-11-01T00:00:00.000Z',
};
const event = {
  sourceEventId: 'synthetic-legacy-paid-order-001',
  userId,
  kind: 'paid_membership_renewal',
  benefit: 'pro_plus',
  paymentStatus: 'settled',
  refundStatus: 'none',
  disputeStatus: 'none',
  paidAt: '2026-11-01T00:00:00.000Z',
  sourceBenefitStartsAt: '2026-11-01T00:00:00.000Z',
  sourceBenefitEndsAt: '2026-12-01T00:00:00.000Z',
  reconciliation: {
    paymentVerified: true,
    ownershipVerified: true,
    excludedFromOriginalImport: true,
    notCreditedOnNewSite: true,
    unusedBenefitVerified: true,
    decisionId,
    approvedUncreditedMilliseconds: 7 * 86400000,
  },
};
const plan = (sourceEvents, appliedReceipts = []) =>
  planEntitlementDelta({
    userId,
    targetBaseline,
    sourceEvents,
    appliedReceipts,
    originalCutoff: '2026-10-24T12:02:47.053609Z',
    finalCutoff: '2026-11-09T00:00:00.000Z',
    decisionId,
  });

test('reviewed uncredited duration preserves newer paid expiry instead of taking the larger site date', () => {
  const result = plan([event]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.nextUntil, '2027-02-08T00:00:00.000Z');
  assert.equal(result.approvedMilliseconds, 7 * 86400000);
  assert.equal(result.policy, 'candidate-reviewed-uncredited-duration-v1');
});
test('stable source event dedup survives a changed target baseline', () => {
  const first = plan([event, event]);
  assert.equal(first.events.length, 1);
  assert.equal(first.duplicateEvents, 1);
  const receipt = {
    event_key: first.events[0].eventKey,
    event_digest: first.events[0].eventDigest,
    user_id: userId,
  };
  const replay = plan([event], [receipt]);
  assert.equal(replay.events.length, 0);
  assert.equal(replay.approvedMilliseconds, 0);
  assert.equal(replay.nextUntil, targetBaseline.pro_plus_until);
  const changed = structuredClone(event);
  changed.reconciliation.approvedUncreditedMilliseconds++;
  assert.equal(plan([changed], [receipt]).conflicts[0].reason, 'APPLIED_EVENT_CHANGED');
});
test('unknown, refunded, disputed, unowned, already included and unreviewed events block', () => {
  for (const mutation of [
    (e) => {
      e.paymentStatus = 'unknown';
    },
    (e) => {
      e.refundStatus = 'refunded';
    },
    (e) => {
      e.disputeStatus = 'open';
    },
    (e) => {
      e.userId = 'unmapped';
    },
    (e) => {
      e.kind = 'adjustment';
    },
    (e) => {
      e.reconciliation.excludedFromOriginalImport = false;
    },
    (e) => {
      e.reconciliation.notCreditedOnNewSite = false;
    },
    (e) => {
      delete e.reconciliation;
    },
    (e) => {
      e.reconciliation.approvedUncreditedMilliseconds = 31 * 86400000;
    },
  ]) {
    const copy = structuredClone(event);
    mutation(copy);
    const result = plan([copy]);
    assert.ok(result.conflicts.length > 0);
    assert.equal(result.events.length, 0);
  }
});
test('different payloads under one source ID and events outside the final window cannot be guessed', () => {
  const changed = structuredClone(event);
  changed.reconciliation.approvedUncreditedMilliseconds++;
  assert.equal(plan([event, changed]).conflicts[0].reason, 'SOURCE_EVENT_CONFLICT');
  assert.equal(
    plan([{ ...event, paidAt: '2026-11-10T00:00:00Z' }]).conflicts[0].reason,
    'EVENT_OUTSIDE_REVIEW_WINDOW',
  );
  assert.equal(
    plan([{ ...event, paidAt: '2026-10-20T00:00:00Z' }]).conflicts[0].reason,
    'EVENT_OUTSIDE_REVIEW_WINDOW',
  );
});
