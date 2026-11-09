import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAINTENANCE_WRITERS,
  buildMaintenancePlan,
  createMaintenanceState,
  assertIsolatedFixture,
  evaluateMaintenanceTransition,
  reconcileReceiptJournal,
} from './migration-maintenance.mjs';
import { runBackupRehearsal } from './migration-maintenance-backup.mjs';
import { runPaymentMaintenanceRehearsal } from './migration-maintenance-payment.mjs';

const target = { kind: 'isolated-fixture', network: 'none' };
function evidence(next, extra = {}) {
  return {
    next,
    inventoryComplete: true,
    writers: Object.fromEntries(MAINTENANCE_WRITERS.map((writer) => [writer, 'stopped'])),
    payments: {
      newOrdersEnabled: false,
      legacyRecognizers: 0,
      newRecognizers: 1,
      captureDurable: true,
      journalOutsideRestore: true,
      queued: 0,
      fulfillment: ['settled', 'released'].includes(next) ? 'controlled-reconciliation' : 'held',
    },
    inFlight: { calls: 0, generations: 0, jobs: 0, channels: 0, paymentTransactions: 0 },
    ...extra,
  };
}
function advance(state, input) {
  const result = evaluateMaintenanceTransition(state, input);
  assert.equal(result.ok, true, result.blockers.join(', '));
  return result.state;
}
function baseline() {
  let state = createMaintenanceState('synthetic-maintenance-test');
  state = advance(state, evidence('frozen'));
  state = advance(state, evidence('drained'));
  return advance(
    state,
    evidence('baseline', {
      cutoff: '2026-11-09T00:00:00.000Z',
      baselineId: 'synthetic-baseline-test',
      captureCheckpointPersisted: true,
    }),
  );
}
const receipt = {
  deviceId: 'synthetic-device',
  eventId: 'synthetic-event',
  channel: 'wechat',
  amountFen: 500,
  observedAt: '2026-11-09T00:00:00.000Z',
  postedAt: '2026-11-09T00:00:00.000Z',
};

test('default CLI is plan-only and refuses all execution targets', () => {
  assert.equal(buildMaintenancePlan().productionExecutable, false);
  const script = fileURLToPath(new URL('./migration-maintenance.mjs', import.meta.url));
  const plan = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).mode, 'plan-only');
  assert.notEqual(spawnSync(process.execPath, [script, '--execute', 'production']).status, 0);
  for (const invalid of [
    undefined,
    { kind: 'production', network: 'none' },
    { ...target, server: 'app.weiban.online' },
    { ...target, network: 'online' },
  ]) {
    assert.throws(() => assertIsolatedFixture(invalid), /ONLY_NETWORKLESS/u);
    assert.throws(() => runBackupRehearsal({ target: invalid }), /ONLY_NETWORKLESS/u);
  }
});

test('payment adapter refuses a supplied database or a remote target before invoking Docker', async () => {
  await assert.rejects(
    runPaymentMaintenanceRehearsal({
      target: { kind: 'production', network: 'loopback-container' },
    }),
    /ONLY_OWNED_LOCAL_CONTAINER/u,
  );
  await assert.rejects(
    runPaymentMaintenanceRehearsal({
      target: {
        kind: 'isolated-fixture',
        network: 'loopback-container',
        url: 'postgres://fixture@127.0.0.1/weiban_test',
      },
    }),
    /ONLY_OWNED_LOCAL_CONTAINER/u,
  );
});

test('a missing writer, active job, unknown count or two recognizers blocks before baseline', () => {
  const state = createMaintenanceState('synthetic-blocking-test');
  for (const writer of MAINTENANCE_WRITERS) {
    const input = evidence('frozen');
    delete input.writers[writer];
    assert.ok(
      evaluateMaintenanceTransition(state, input).blockers.includes(`WRITER_NOT_STOPPED:${writer}`),
    );
  }
  const both = evidence('frozen');
  both.payments.legacyRecognizers = 1;
  assert.equal(evaluateMaintenanceTransition(state, both).ok, false);
  const lost = evidence('frozen');
  lost.payments.journalOutsideRestore = false;
  assert.equal(evaluateMaintenanceTransition(state, lost).ok, false);
  const frozen = advance(state, evidence('frozen'));
  for (const remaining of [1, undefined]) {
    const input = evidence('drained');
    input.inFlight.jobs = remaining;
    assert.equal(evaluateMaintenanceTransition(frozen, input).ok, false);
  }
  assert.equal(evaluateMaintenanceTransition(state, evidence('imported')).ok, false);
});

test('baseline backups must match both sites, remain retained, and leave the app stopped', () => {
  const state = baseline();
  const ready = {
    baselineId: state.baselineId,
    consistent: true,
    checksumsVerified: true,
    restoreVerified: true,
    retentionProtected: true,
  };
  const input = evidence('backed-up', {
    backups: { legacy: { ...ready }, target: { ...ready } },
    capacityVerified: true,
    recoveryMaterialVerified: true,
    backupKeptApplicationStopped: true,
  });
  assert.equal(evaluateMaintenanceTransition(state, input).ok, true);
  for (const change of [
    (e) => {
      e.backups.target.baselineId = 'synthetic-stale';
    },
    (e) => {
      e.backups.legacy.restoreVerified = false;
    },
    (e) => {
      e.backups.target.retentionProtected = false;
    },
    (e) => {
      e.backupKeptApplicationStopped = false;
    },
  ]) {
    const copy = structuredClone(input);
    change(copy);
    assert.equal(evaluateMaintenanceTransition(state, copy).ok, false);
  }
});

test('receipt reconciliation detects loss, mutation, replay and a matched receipt without one ledger', () => {
  const matched = {
    ...receipt,
    status: 'matched',
    ledgerCount: 1,
    expectedLedgerCount: 1,
    fulfillmentCount: 1,
  };
  const good = reconcileReceiptJournal([receipt, receipt], [matched]);
  assert.deepEqual(good, {
    captured: 1,
    recorded: 1,
    missing: 0,
    unexpected: 0,
    unresolved: 0,
    conflicts: 0,
    duplicateRecords: 0,
    duplicateLedgerEntries: 0,
    invalidRows: 0,
  });
  assert.equal(reconcileReceiptJournal([receipt], []).missing, 1);
  assert.equal(
    reconcileReceiptJournal([receipt], [{ ...matched, observedAt: '2026-11-09T01:00:00Z' }])
      .conflicts,
    1,
  );
  assert.equal(reconcileReceiptJournal([receipt], [matched, matched]).duplicateRecords, 1);
  assert.equal(
    reconcileReceiptJournal([receipt], [{ ...matched, ledgerCount: 2 }]).duplicateLedgerEntries,
    1,
  );
  assert.equal(reconcileReceiptJournal([receipt], [{ ...matched, ledgerCount: 0 }]).conflicts, 1);
  assert.equal(
    reconcileReceiptJournal([receipt], [{ ...receipt, status: 'review', ledgerCount: 0 }])
      .unresolved,
    1,
  );
});

test('full evidence sequence reaches release only after domain and receipt reconciliation', () => {
  let state = baseline();
  const ready = {
    baselineId: state.baselineId,
    consistent: true,
    checksumsVerified: true,
    restoreVerified: true,
    retentionProtected: true,
  };
  state = advance(
    state,
    evidence('backed-up', {
      backups: { legacy: ready, target: ready },
      capacityVerified: true,
      recoveryMaterialVerified: true,
      backupKeptApplicationStopped: true,
    }),
  );
  state = advance(
    state,
    evidence('imported', {
      import: {
        baselineId: state.baselineId,
        batchReceiptsPersisted: true,
        failedBatches: 0,
        paidCalls: 0,
        historicalNotifications: 0,
      },
    }),
  );
  const reconciliation = {
    identityErrors: 0,
    assetDifferences: 0,
    deletionViolations: 0,
    orderOrCursorErrors: 0,
    mediaIntegrityErrors: 0,
    ownershipErrors: 0,
    unapprovedExceptions: 0,
    allDomainsCovered: true,
  };
  assert.equal(
    evaluateMaintenanceTransition(
      state,
      evidence('reconciled', {
        reconciliation: { ...reconciliation, deletionViolations: 1 },
      }),
    ).ok,
    false,
  );
  state = advance(state, evidence('reconciled', { reconciliation }));
  const receiptReconciliation = reconcileReceiptJournal(
    [receipt],
    [
      {
        ...receipt,
        status: 'matched',
        ledgerCount: 1,
        expectedLedgerCount: 1,
        fulfillmentCount: 1,
      },
    ],
  );
  assert.equal(
    evaluateMaintenanceTransition(
      state,
      evidence('settled', {
        receiptReconciliation: { ...receiptReconciliation, unresolved: 1 },
      }),
    ).ok,
    false,
  );
  state = advance(state, evidence('settled', { receiptReconciliation }));
  state = advance(
    state,
    evidence('released', { receiptReconciliation, approvedRelease: true, entryChecksPassed: true }),
  );
  assert.equal(state.phase, 'released');
  assert.equal(state.transitions.length, 8);
});

test('rollback cannot discard new writes or the independent receipt journal', () => {
  const state = baseline();
  const input = evidence('rolled-back', {
    newBusinessWrites: 0,
    restore: {
      verified: true,
      baselineId: state.baselineId,
      receiptJournalPreserved: true,
      legacyPaymentsRemainOff: true,
    },
  });
  assert.equal(evaluateMaintenanceTransition(state, input).ok, true);
  assert.equal(evaluateMaintenanceTransition(state, { ...input, newBusinessWrites: 1 }).ok, false);
  assert.equal(
    evaluateMaintenanceTransition(state, {
      ...input,
      restore: {
        ...input.restore,
        receiptJournalPreserved: false,
      },
    }).ok,
    false,
  );
  assert.equal(evaluateMaintenanceTransition({ ...state, phase: 'released' }, input).ok, false);
});

for (const appInitiallyRunning of [false, true]) {
  for (const failure of ['none', 'dump', 'term', 'space']) {
    test(`real backup.sh: initial app=${appInitiallyRunning ? 'running' : 'stopped'}, outcome=${failure}`, () => {
      const result = runBackupRehearsal({ target, appInitiallyRunning, failure });
      assert.equal(result.actualBackupScriptExecuted, true);
      assert.equal(result.unexpectedCommands, false, result.stderr);
      assert.equal(result.systemctlCalls, 0);
      assert.equal(result.appFinallyRunning, appInitiallyRunning, result.stderr);
      assert.equal(
        result.starts,
        appInitiallyRunning && failure !== 'space' ? 1 : 0,
        result.stdout + result.stderr,
      );
      assert.equal(result.stops, failure === 'space' ? 0 : 1);
      assert.equal(
        result.completeBundles,
        failure === 'none' ? 1 : 0,
        result.stdout + result.stderr,
      );
      assert.equal(result.partialBundles, 0);
      assert.equal(result.exitCode === 0, failure === 'none', result.stdout + result.stderr);
      if (failure === 'term') assert.equal(result.exitCode, 143, result.stderr);
    });
  }
}
