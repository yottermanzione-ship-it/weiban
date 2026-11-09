/** Manager-approved exact user deletion list. No time-range delete, source discovery or memory writes. */
import { legacyId } from './legacy-content-rules.mjs';
import { fingerprint, invariant, utc } from './fast-cutover-core.mjs';
import { assertMigrationOwnersAllowed, isMigrationOwnerPreserved } from './fast-cutover-owners.mjs';
import { assertFastExecution, assertFastPlan } from './fast-cutover-execution.mjs';
async function readTargets(tx, fragments, options, lock = false) {
  const ids = fragments.map((row) => row.messageId);
  const rows = (
    await tx.query(
      `SELECT m.*,c.owner_user_id,EXISTS(SELECT 1 FROM chat.hidden_messages h WHERE h.message_id=m.id AND h.user_id=c.owner_user_id) AS hidden
    FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE m.id=ANY($1::uuid[]) ORDER BY m.id${lock ? ' FOR UPDATE OF m,c' : ''}`,
      [ids],
    )
  ).rows;
  assertMigrationOwnersAllowed(
    rows.map((row) => row.owner_user_id),
    options,
  );
  const expected = new Map(fragments.map((row) => [row.messageId, row]));
  for (const row of rows) {
    const item = expected.get(row.id);
    invariant(
      row.owner_user_id === item.ownerId &&
        row.conversation_id === item.conversationId &&
        row.client_msg_id === item.clientId &&
        Number(row.seq) === item.seq &&
        row.status === item.status,
      'FAST_DELETION_TARGET_CHANGED',
    );
  }
  invariant(
    !(
      await tx.query(
        'SELECT id FROM chat.messages WHERE quote_message_id=ANY($1::uuid[]) LIMIT 1',
        [ids],
      )
    ).rows.length,
    'FAST_DELETION_QUOTES_REQUIRE_REVIEW',
  );
  return rows;
}
export async function planFastDeletions({
  database,
  fragments,
  sourceDigest,
  cutoff,
  options = {},
}) {
  const allowed = fragments.filter((row) => !isMigrationOwnerPreserved(row.ownerId, options));
  invariant(
    new Set(allowed.map((row) => row.messageId)).size === allowed.length,
    'FAST_DELETION_DUPLICATE',
  );
  for (const row of allowed)
    invariant(
      ['chat_history', 'group_messages'].includes(row.table) &&
        row.fullSourceScope === true &&
        ['user-message', 'user-clear'].includes(row.actorScope) &&
        /^[a-f0-9]{64}$/u.test(row.sourceRowDigest) &&
        utc(row.sourceCreatedAt) <= '2026-10-24T12:02:47.053Z' &&
        utc(row.sourceDeletedAt) > '2026-10-24T12:02:47.053Z' &&
        utc(row.sourceDeletedAt) <= utc(cutoff) &&
        row.messageId === legacyId('message', row.table, String(row.sourceId), row.part) &&
        row.clientId === legacyId('client-message', row.table, String(row.sourceId), row.part) &&
        Number.isSafeInteger(row.part) &&
        row.part >= 0 &&
        Number.isSafeInteger(row.seq) &&
        row.seq > 0,
      'FAST_DELETION_SOURCE_PROOF_REQUIRED',
    );
  const rows = await readTargets(database, allowed, options);
  const plan = {
    version: 1,
    sourceDigest,
    cutoff: utc(cutoff),
    fragments: allowed,
    baseline: fingerprint(rows),
    excluded: fragments.length - allowed.length,
    found: rows.length,
    missing: allowed.length - rows.length,
  };
  return { ...plan, digest: fingerprint(plan) };
}
export async function applyFastDeletions({
  database,
  execution,
  execute = false,
  plan,
  options = {},
}) {
  assertFastPlan(plan);
  assertMigrationOwnersAllowed(
    plan.fragments.map((row) => row.ownerId),
    options,
  );
  if (!execute)
    return { mode: 'plan', found: plan.found, missing: plan.missing, excluded: plan.excluded };
  await assertFastExecution(database, execution, plan.digest, plan.sourceDigest);
  return database.transaction(async (tx) => {
    const owners = [...new Set(plan.fragments.map((row) => row.ownerId))].sort();
    for (const owner of owners)
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
        owner,
      ]);
    const rows = await readTargets(tx, plan.fragments, options, true);
    invariant(fingerprint(rows) === plan.baseline, 'FAST_DELETION_REPLAN_REQUIRED');
    let hidden = 0;
    for (const owner of owners) {
      const ids = rows
        .filter((row) => row.owner_user_id === owner && !row.hidden)
        .map((row) => row.id);
      if (!ids.length) continue;
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('realtime:' || $1,0))", [
        owner,
      ]);
      hidden += (
        await tx.query(
          'INSERT INTO chat.hidden_messages(message_id,user_id) SELECT x,$2::uuid FROM unnest($1::uuid[]) x ON CONFLICT DO NOTHING',
          [ids, owner],
        )
      ).rowCount;
      await tx.query(
        `INSERT INTO realtime.user_update_cursors(user_id,last_update_seq,trimmed_through) VALUES($1,1,1)
        ON CONFLICT(user_id) DO UPDATE SET last_update_seq=realtime.user_update_cursors.last_update_seq+1,trimmed_through=realtime.user_update_cursors.last_update_seq+1`,
        [owner],
      );
    }
    return { hidden, missing: plan.missing };
  });
}
