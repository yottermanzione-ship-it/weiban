/** Explicit operator entry only. No connection discovery, source files, SSH, service changes or CLI. */
import { fingerprint, invariant } from './fast-cutover-core.mjs';
export async function inspectFastTarget(database) {
  const row = (
    await database.query(
      'SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid',
    )
  ).rows[0];
  return { name: row.name, oid: row.oid };
}
/** This checks identity and reviewed input; real maintenance/backup are separate operator actions, not proven here. */
export async function assertFastExecution(database, execution, planDigest, sourceDigest) {
  invariant(
    execution?.action === 'APPLY_FAST_CUTOVER_20261109',
    'FAST_EXPLICIT_EXECUTION_REQUIRED',
  );
  invariant(
    typeof execution.connectionString === 'string' &&
      database?.pool?.options?.connectionString === execution.connectionString,
    'FAST_CONNECTION_MISMATCH',
  );
  invariant(
    /^[a-f0-9]{64}$/u.test(sourceDigest) &&
      execution.sourceDigest === sourceDigest &&
      execution.planDigest === planDigest,
    'FAST_REVIEWED_INPUT_MISMATCH',
  );
  const actual = await inspectFastTarget(database);
  invariant(
    actual.name === execution.databaseName && actual.oid === String(execution.databaseOid),
    'FAST_TARGET_IDENTITY_MISMATCH',
  );
}
export function assertFastPlan(plan) {
  const { digest, ...body } = plan;
  invariant(digest === fingerprint(body), 'FAST_PLAN_CHANGED');
}
