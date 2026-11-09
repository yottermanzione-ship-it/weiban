/** Planning/evidence checks only. This module has no production execution adapter. */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const MAINTENANCE_WRITERS = Object.freeze([
  'legacy-api',
  'new-api',
  'legacy-admin',
  'new-admin',
  'legacy-workers',
  'new-workers',
  'legacy-channels',
  'new-channels',
]);
export const MAINTENANCE_PHASES = Object.freeze([
  'planned',
  'frozen',
  'drained',
  'baseline',
  'backed-up',
  'imported',
  'reconciled',
  'settled',
  'released',
]);
const zero = (value) => Number.isSafeInteger(value) && value === 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function buildMaintenancePlan() {
  return {
    mode: 'plan-only',
    productionExecutable: false,
    phases: [...MAINTENANCE_PHASES],
    writers: [...MAINTENANCE_WRITERS],
    prerequisites: [
      'Freeze the final release identity, mapping, exception decisions and rollback owner.',
      'Prove available capacity and isolate/preserve the matching database, media and recovery material.',
      'Stop new orders; preserve original notification identity/time in a durable journal outside the restore target.',
      'Stop both sites and all listed writers before calling the existing backup script.',
    ],
    paymentOrder: [
      'Keep legacy recognition disabled; never run two independent recognizers for the same receipts.',
      'Hold fulfillment while the snapshot and import run; collecting a notice is not permission to credit it.',
      'After data reconciliation, record every queued receipt with its original identity and timestamps.',
      'Resolve delayed/disabled receipts only against explicitly verified original orders; retry with the same IDs.',
      'Require zero missing receipts, zero duplicate ledger entries and zero unresolved window receipts before new orders reopen.',
    ],
    rollback: [
      'Before new business writes, restore only the verified matching baseline and retain the external receipt journal.',
      'After any new business write/payment, preserve new data and use forward repair or a separately reconciled reverse migration.',
      'Never reopen legacy payment recognition as a side effect of rollback.',
    ],
  };
}

export function createMaintenanceState(runId) {
  if (!/^synthetic-[a-z0-9-]+$/u.test(runId ?? '')) throw new Error('SYNTHETIC_RUN_ID_REQUIRED');
  return { runId, phase: 'planned', transitions: [], baselineId: null };
}

/** No URLs/commands/credentials are accepted, even for an explicitly requested execute mode. */
export function assertIsolatedFixture(target) {
  if (
    !target ||
    Object.keys(target).some((key) => !['kind', 'network'].includes(key)) ||
    target.kind !== 'isolated-fixture' ||
    target.network !== 'none'
  ) {
    throw new Error('ONLY_NETWORKLESS_ISOLATED_FIXTURE_ALLOWED');
  }
}

/** Compare a synthetic durable ingress journal with the corresponding recorded receipts. */
export function reconcileReceiptJournal(captured, recorded) {
  if (!Array.isArray(captured) || !Array.isArray(recorded))
    throw new Error('RECEIPT_LISTS_REQUIRED');
  const source = new Map(),
    destination = new Map();
  let conflicts = 0,
    duplicateRecords = 0,
    duplicateLedgerEntries = 0,
    invalidRows = 0;
  const key = (row) => `${row.deviceId}\0${row.eventId}`;
  const shape = (row) => JSON.stringify([row.channel, row.amountFen, row.observedAt, row.postedAt]);
  const valid = (row) =>
    row &&
    typeof row.deviceId === 'string' &&
    row.deviceId.length > 0 &&
    typeof row.eventId === 'string' &&
    row.eventId.length > 0 &&
    ['wechat', 'alipay'].includes(row.channel) &&
    Number.isSafeInteger(row.amountFen) &&
    row.amountFen > 0 &&
    instant(row.observedAt) &&
    instant(row.postedAt);
  for (const row of captured) {
    if (!valid(row)) {
      invalidRows++;
      continue;
    }
    if (source.has(key(row)) && shape(source.get(key(row))) !== shape(row)) conflicts++;
    else source.set(key(row), row);
  }
  for (const row of recorded) {
    if (
      !valid(row) ||
      !count(row.ledgerCount) ||
      !['review', 'matched', 'ignored'].includes(row.status)
    ) {
      invalidRows++;
      continue;
    }
    if (destination.has(key(row))) duplicateRecords++;
    destination.set(key(row), row);
    if (row.ledgerCount > 1) duplicateLedgerEntries += row.ledgerCount - 1;
    if (
      (row.status === 'matched' &&
        (!count(row.expectedLedgerCount) ||
          row.expectedLedgerCount > 1 ||
          row.ledgerCount !== row.expectedLedgerCount ||
          row.fulfillmentCount !== 1)) ||
      (row.status !== 'matched' && row.ledgerCount !== 0)
    )
      conflicts++;
  }
  let missing = 0,
    unexpected = 0,
    unresolved = 0;
  for (const [id, row] of source) {
    const saved = destination.get(id);
    if (!saved) {
      missing++;
      continue;
    }
    if (shape(row) !== shape(saved)) conflicts++;
    if (saved.status !== 'matched') unresolved++;
  }
  for (const id of destination.keys()) if (!source.has(id)) unexpected++;
  return {
    captured: source.size,
    recorded: destination.size,
    missing,
    unexpected,
    unresolved,
    conflicts,
    duplicateRecords,
    duplicateLedgerEntries,
    invalidRows,
  };
}

/** Evidence is required afresh at every checkpoint; absent evidence never means zero. */
export function evaluateMaintenanceTransition(state, evidence = {}) {
  const blockers = [],
    next = evidence.next;
  const need = (ok, reason) => {
    if (!ok) blockers.push(reason);
  };
  need(state && MAINTENANCE_PHASES.includes(state.phase), 'INVALID_CURRENT_PHASE');
  if (!state || !MAINTENANCE_PHASES.includes(state.phase)) return { ok: false, blockers, state };
  const rollback = next === 'rolled-back';
  need(
    rollback || MAINTENANCE_PHASES[MAINTENANCE_PHASES.indexOf(state.phase) + 1] === next,
    'PHASE_ORDER_VIOLATION',
  );
  need(evidence.inventoryComplete === true, 'WRITER_INVENTORY_INCOMPLETE');
  for (const writer of MAINTENANCE_WRITERS)
    need(evidence.writers?.[writer] === 'stopped', `WRITER_NOT_STOPPED:${writer}`);
  const payment = evidence.payments ?? {};
  need(payment.newOrdersEnabled === false, 'NEW_ORDERS_NOT_CLOSED');
  need(payment.legacyRecognizers === 0, 'LEGACY_RECOGNIZER_MUST_STAY_OFF');
  need(
    count(payment.newRecognizers) && payment.newRecognizers <= 1,
    'MULTIPLE_OR_UNKNOWN_NEW_RECOGNIZERS',
  );
  need(
    payment.captureDurable === true && payment.journalOutsideRestore === true,
    'RECEIPT_CAPTURE_NOT_PRESERVED',
  );
  need(
    payment.fulfillment ===
      (next === 'settled' || next === 'released' ? 'controlled-reconciliation' : 'held'),
    'FULFILLMENT_NOT_CONTROLLED',
  );
  if (next !== 'frozen') {
    for (const job of ['calls', 'generations', 'jobs', 'channels', 'paymentTransactions']) {
      need(zero(evidence.inFlight?.[job]), `INFLIGHT_NOT_DRAINED:${job}`);
    }
  }
  if (rollback) {
    need(
      state.phase !== 'planned' && state.phase !== 'released',
      'BLIND_RESTORE_AFTER_RELEASE_FORBIDDEN',
    );
    need(zero(evidence.newBusinessWrites), 'BLIND_RESTORE_WITH_NEW_WRITES_FORBIDDEN');
    need(
      evidence.restore?.verified === true &&
        evidence.restore?.baselineId === state.baselineId &&
        state.baselineId !== null,
      'MATCHING_RESTORE_EVIDENCE_REQUIRED',
    );
    need(evidence.restore?.receiptJournalPreserved === true, 'RESTORE_WOULD_LOSE_RECEIPTS');
    need(
      evidence.restore?.legacyPaymentsRemainOff === true,
      'RESTORE_MUST_NOT_REOPEN_LEGACY_PAYMENTS',
    );
  } else if (next === 'baseline') {
    need(
      instant(evidence.cutoff) && /^synthetic-[a-z0-9-]+$/u.test(evidence.baselineId ?? ''),
      'FINAL_BASELINE_REQUIRED',
    );
    need(evidence.captureCheckpointPersisted === true, 'CAPTURE_CHECKPOINT_NOT_PERSISTED');
  } else if (next === 'backed-up') {
    for (const site of ['legacy', 'target']) {
      const backup = evidence.backups?.[site];
      need(
        backup?.baselineId === state.baselineId &&
          backup?.consistent === true &&
          backup?.checksumsVerified === true &&
          backup?.restoreVerified === true &&
          backup?.retentionProtected === true,
        `BACKUP_NOT_READY:${site}`,
      );
    }
    need(
      evidence.capacityVerified === true && evidence.recoveryMaterialVerified === true,
      'CAPACITY_OR_RECOVERY_MATERIAL_UNVERIFIED',
    );
    need(evidence.backupKeptApplicationStopped === true, 'BACKUP_REOPENED_APPLICATION');
  } else if (next === 'imported') {
    need(
      evidence.import?.baselineId === state.baselineId &&
        evidence.import?.batchReceiptsPersisted === true &&
        zero(evidence.import?.failedBatches),
      'IMPORT_RECEIPTS_INCOMPLETE',
    );
    need(
      evidence.import?.paidCalls === 0 && evidence.import?.historicalNotifications === 0,
      'IMPORT_REPLAYED_SIDE_EFFECTS',
    );
  } else if (next === 'reconciled') {
    for (const check of [
      'identityErrors',
      'assetDifferences',
      'deletionViolations',
      'orderOrCursorErrors',
      'mediaIntegrityErrors',
      'ownershipErrors',
      'unapprovedExceptions',
    ]) {
      need(zero(evidence.reconciliation?.[check]), `RECONCILIATION_FAILED:${check}`);
    }
    need(evidence.reconciliation?.allDomainsCovered === true, 'RECONCILIATION_COVERAGE_INCOMPLETE');
  } else if (next === 'settled' || next === 'released') {
    for (const check of [
      'missing',
      'unexpected',
      'unresolved',
      'conflicts',
      'duplicateRecords',
      'duplicateLedgerEntries',
      'invalidRows',
    ]) {
      need(zero(evidence.receiptReconciliation?.[check]), `RECEIPTS_NOT_SETTLED:${check}`);
    }
    need(
      count(evidence.receiptReconciliation?.captured) &&
        evidence.receiptReconciliation.captured === evidence.receiptReconciliation.recorded,
      'RECEIPT_COUNTS_NOT_RECONCILED',
    );
    need(
      zero(payment.queued) && payment.newRecognizers === 1,
      'SINGLE_CONSUMER_OR_QUEUE_NOT_READY',
    );
    if (next === 'released') {
      need(
        evidence.approvedRelease === true && evidence.entryChecksPassed === true,
        'RELEASE_NOT_APPROVED_OR_ENTRY_UNVERIFIED',
      );
    }
  }
  if (blockers.length) return { ok: false, blockers, state };
  return {
    ok: true,
    blockers: [],
    state: {
      ...state,
      phase: next,
      baselineId: next === 'baseline' ? evidence.baselineId : state.baselineId,
      transitions: [...state.transitions, { from: state.phase, to: next }],
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((arg) => arg !== '--plan'))
    throw new Error('PLAN_ONLY_NO_EXECUTION_ADAPTER');
  process.stdout.write(JSON.stringify(buildMaintenancePlan(), null, 2) + '\n');
}
