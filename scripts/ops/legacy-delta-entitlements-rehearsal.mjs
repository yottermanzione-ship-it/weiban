/** Actual identity.memberships checks on a caller-owned synthetic fixture database. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fingerprint } from './legacy-delta-core.mjs';
import { assertFixtureDatabase } from './legacy-delta-db.mjs';
import {
  readEntitlementBaseline,
  planEntitlementDelta,
  initializeEntitlementFixture,
  applyEntitlementDelta,
} from './legacy-delta-entitlements.mjs';

export async function runEntitlementDatabaseRehearsal({ database, target, userIds }) {
  await assertFixtureDatabase(database, target);
  assert.equal(new Set(userIds).size, 3);
  await initializeEntitlementFixture(database, target);
  const decisionId = 'synthetic-explicit-entitlement-review';
  const maintenance = { writersStopped: true, notificationsCaptured: true };
  const checks = [],
    started = performance.now();
  for (const id of userIds) {
    await database.query(
      `INSERT INTO identity.memberships(user_id,pro_plus_until,updated_at)
      VALUES($1,'2027-02-01T00:00:00Z','2026-11-01T00:00:00Z')`,
      [id],
    );
  }
  const retained = await database.query(
    'SELECT id,password_hash FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id',
    [userIds],
  );
  const ledgers = (await database.query('SELECT count(*)::int AS n FROM billing.ledger_entries'))
    .rows[0].n;
  const make = async (index, overrides = {}, appliedReceipts = []) => {
    const userId = userIds[index];
    return planEntitlementDelta({
      userId,
      targetBaseline: await readEntitlementBaseline(database, userId),
      sourceEvents: [
        {
          sourceEventId: `synthetic-reconciled-legacy-order-${index}`,
          userId,
          kind: 'paid_membership_renewal',
          benefit: 'pro_plus',
          paymentStatus: 'settled',
          refundStatus: 'none',
          disputeStatus: 'none',
          paidAt: '2026-11-01T00:00:00Z',
          sourceBenefitStartsAt: '2026-11-01T00:00:00Z',
          sourceBenefitEndsAt: '2026-12-01T00:00:00Z',
          reconciliation: {
            paymentVerified: true,
            ownershipVerified: true,
            excludedFromOriginalImport: true,
            notCreditedOnNewSite: true,
            unusedBenefitVerified: true,
            decisionId,
            approvedUncreditedMilliseconds: 7 * 86400000,
          },
          ...overrides,
        },
      ],
      appliedReceipts,
      originalCutoff: '2026-10-24T12:02:47.053609Z',
      finalCutoff: '2026-11-09T00:00:00Z',
      decisionId,
    });
  };
  const check = async (name, action) => {
    const start = performance.now();
    await action();
    checks.push({ name, passed: true, elapsedMs: Math.round(performance.now() - start) });
  };
  await check(
    'concurrent replay credits the reviewed legacy event once while retaining newer membership',
    async () => {
      const plan = await make(0);
      const results = await Promise.all(
        [0, 1, 2].map(() => applyEntitlementDelta({ database, target, plan, maintenance })),
      );
      assert.equal(results.filter((result) => result.status === 'applied').length, 1);
      assert.equal(
        (await readEntitlementBaseline(database, userIds[0])).pro_plus_until.toISOString(),
        '2027-02-08T00:00:00.000Z',
      );
      const receipts = (
        await database.query(
          'SELECT * FROM public.codex_migration_entitlement_receipts WHERE user_id=$1',
          [userIds[0]],
        )
      ).rows;
      assert.equal(receipts.length, 1);
      const replan = await make(0, {}, receipts);
      assert.equal(replan.events.length, 0);
      assert.equal(
        (await applyEntitlementDelta({ database, target, plan: replan, maintenance })).status,
        'already_applied',
      );
      assert.equal(
        (
          await database.query(
            'SELECT count(*)::int AS n FROM identity.membership_changes WHERE user_id=$1',
            [userIds[0]],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    'interruption after membership update rolls back entitlement, audit and receipt together',
    async () => {
      const plan = await make(1),
        before = await readEntitlementBaseline(database, userIds[1]);
      await assert.rejects(
        applyEntitlementDelta({ database, target, plan, maintenance, fault: 'after-membership' }),
        /SYNTHETIC_ENTITLEMENT_INTERRUPTION/u,
      );
      assert.equal(
        fingerprint(await readEntitlementBaseline(database, userIds[1])),
        fingerprint(before),
      );
      assert.equal(
        (
          await database.query(
            'SELECT count(*)::int AS n FROM public.codex_migration_entitlement_receipts WHERE user_id=$1',
            [userIds[1]],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await applyEntitlementDelta({ database, target, plan, maintenance })).status,
        'applied',
      );
      assert.equal(
        (await applyEntitlementDelta({ database, target, plan, maintenance })).status,
        'already_applied',
      );
    },
  );
  await check(
    'target renewal after review refuses the stale plan without overwriting its expiry',
    async () => {
      const plan = await make(2);
      await database.query(
        "UPDATE identity.memberships SET pro_plus_until='2027-03-01T00:00:00Z' WHERE user_id=$1",
        [userIds[2]],
      );
      await assert.rejects(
        applyEntitlementDelta({ database, target, plan, maintenance }),
        /ENTITLEMENT_TARGET_CHANGED_REPLAN_REQUIRED/u,
      );
      assert.equal(
        (await readEntitlementBaseline(database, userIds[2])).pro_plus_until.toISOString(),
        '2027-03-01T00:00:00.000Z',
      );
    },
  );
  await check(
    'refund or unknown evidence is held; passwords and wallet ledger remain unchanged',
    async () => {
      for (const overrides of [{ refundStatus: 'refunded' }, { paymentStatus: 'unknown' }]) {
        const plan = await make(2, overrides);
        await assert.rejects(
          applyEntitlementDelta({ database, target, plan, maintenance }),
          /ENTITLEMENT_PLAN_REQUIRES_REVIEW/u,
        );
      }
      assert.equal(
        fingerprint(
          (
            await database.query(
              'SELECT id,password_hash FROM identity.users WHERE id=ANY($1::uuid[]) ORDER BY id',
              [userIds],
            )
          ).rows,
        ),
        fingerprint(retained.rows),
      );
      assert.equal(
        (await database.query('SELECT count(*)::int AS n FROM billing.ledger_entries')).rows[0].n,
        ledgers,
      );
    },
  );
  return {
    kind: 'synthetic-entitlement-rehearsal',
    candidatePolicy: 'reviewed-uncredited-duration-v1',
    checks,
    elapsedMs: Math.round(performance.now() - started),
    productionApproved: false,
  };
}
