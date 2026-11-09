/** Missing accounts only. Credentials remain in the caller's memory; existing accounts are never updated. */
import { fingerprint, invariant, utc } from './fast-cutover-core.mjs';
import { assertMigrationOwnersAllowed, isMigrationOwnerPreserved } from './fast-cutover-owners.mjs';
import { assertFastExecution, assertFastPlan } from './fast-cutover-execution.mjs';
export function planFastAccounts({
  source,
  existing,
  sourceDigest,
  cutoff,
  previouslyImportedIds = [],
  options = {},
}) {
  const byId = new Map(existing.map((row) => [row.id, row])),
    old = new Set(previouslyImportedIds),
    seen = new Set();
  const insert = [],
    blocked = [];
  let kept = 0,
    excluded = 0;
  for (const row of source) {
    invariant(!seen.has(row.id), 'FAST_DUPLICATE_SOURCE_ACCOUNT');
    seen.add(row.id);
    if (isMigrationOwnerPreserved(row.id, options)) {
      excluded++;
      continue;
    }
    if (byId.has(row.id)) {
      kept++;
      continue;
    }
    if (old.has(row.id) || utc(row.createdAt) <= '2026-10-24T12:02:47.053Z') {
      blocked.push({
        ownerDigest: fingerprint(row.id),
        reason: 'missing_previously_imported_account',
      });
      continue;
    }
    invariant(
      row.status === 'active' && row.role === 'user' && utc(row.createdAt) <= utc(cutoff),
      'FAST_SOURCE_ACCOUNT_INVALID',
    );
    invariant(
      /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/u.test(row.passwordHash),
      'FAST_SUPPORTED_PASSWORD_HASH_REQUIRED',
    );
    insert.push({ id: row.id, sourceFingerprint: fingerprint(row) });
  }
  const plan = { version: 1, sourceDigest, cutoff: utc(cutoff), insert, blocked, kept, excluded };
  return { ...plan, digest: fingerprint(plan) };
}
export async function applyFastAccounts({
  database,
  execution,
  execute = false,
  plan,
  source,
  createDefaults,
  options = {},
}) {
  assertFastPlan(plan);
  invariant(!plan.blocked.length, 'FAST_ACCOUNT_REVIEW_REQUIRED');
  const byId = new Map(source.map((row) => [row.id, row]));
  assertMigrationOwnersAllowed(
    plan.insert.map((row) => row.id),
    options,
  );
  if (!execute)
    return { mode: 'plan', inserted: plan.insert.length, kept: plan.kept, excluded: plan.excluded };
  invariant(typeof createDefaults === 'function', 'FAST_ACTUAL_DEFAULT_SETTINGS_REQUIRED');
  await assertFastExecution(database, execution, plan.digest, plan.sourceDigest);
  return database.transaction(async (tx) => {
    await tx.query('LOCK TABLE identity.users,identity.login_aliases IN SHARE ROW EXCLUSIVE MODE');
    let inserted = 0;
    for (const item of plan.insert) {
      const row = byId.get(item.id);
      invariant(row && fingerprint(row) === item.sourceFingerprint, 'FAST_SOURCE_ACCOUNT_CHANGED');
      assertMigrationOwnersAllowed([row.id], options);
      const current = (
        await tx.query('SELECT id FROM identity.users WHERE id=$1 OR lower(username)=lower($2)', [
          row.id,
          row.username,
        ])
      ).rows;
      if (current.some((user) => user.id === row.id)) continue; // Lost commit acknowledgement: preserve the existing identity.
      invariant(current.length === 0, 'FAST_USERNAME_CONFLICT');
      invariant(
        !(
          await tx.query('SELECT 1 FROM identity.login_aliases WHERE lower(alias)=lower($1)', [
            row.username,
          ])
        ).rows.length,
        'FAST_ALIAS_CONFLICT',
      );
      await tx.query(
        "INSERT INTO identity.users(id,username,password_hash,role,status,created_at,updated_at) VALUES($1,$2,$3,'user','active',$4,$4)",
        [row.id, row.username, row.passwordHash, utc(row.createdAt)],
      );
      await createDefaults(tx, row.id, row.timeZone ?? 'Asia/Shanghai');
      await tx.query(
        'INSERT INTO identity.login_aliases(alias,user_id,created_at) VALUES(lower($1),$2,$3)',
        [row.username, row.id, utc(row.createdAt)],
      );
      await tx.query(
        'UPDATE identity.notification_settings SET proactive_messages_enabled=false,proactive_calls_enabled=false WHERE user_id=$1',
        [row.id],
      );
      inserted++;
    }
    return { inserted };
  });
}
