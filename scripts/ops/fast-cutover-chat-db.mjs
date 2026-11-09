/** Minimal reviewed chat SQL copied from the isolated rehearsal. No discovery, schema, ledger or transport. */
import { assertMigrationOwnersAllowed, migrationOwnersOf } from './fast-cutover-owners.mjs';
import { fingerprint, invariant, translateBoundary, utc } from './fast-cutover-core.mjs';

import { assertFastExecution } from './fast-cutover-execution.mjs';

const directReferences = [
  ['ai_runtime.reply_plans', ['trigger_seq']],
  ['ai_runtime.group_reply_plans', ['trigger_seq']],
  [
    'ai_runtime.memory_states',
    ['barrier_seq', 'cursor_seq', 'window_start_seq', 'fact_trigger_seq'],
  ],
  ['ai_runtime.group_memory_states', ['cursor_seq', 'last_user_seq']],
  ['ai_runtime.private_digests', ['to_seq']],
  ['library.favorites', ['source_seq']],
  ['ai_runtime.model_blocked_messages', ['seq']],
];
const extraReferences = [
  [
    'ai_runtime.chat_summary_states',
    ['covered_seq', 'target_seq'],
    'parent_id IN (SELECT id FROM ai_runtime.memory_states WHERE conversation_id=$1)',
  ],
  [
    'ai_runtime.chat_summary_versions',
    ['from_seq', 'to_seq'],
    'state_id IN (SELECT s.id FROM ai_runtime.chat_summary_states s JOIN ai_runtime.memory_states m ON m.id=s.parent_id WHERE m.conversation_id=$1)',
  ],
];

export const sequenceReferenceRegistry = [...directReferences, ...extraReferences].map(
  ([table, columns]) => ({ table, columns }),
);

export async function readConversationBaseline(tx, id, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const conversation = (await tx.query('SELECT * FROM chat.conversations WHERE id=$1', [id]))
    .rows[0];
  invariant(conversation, 'CONVERSATION_NOT_FOUND');
  const messages = (
    await tx.query('SELECT * FROM chat.messages WHERE conversation_id=$1 ORDER BY seq' + suffix, [
      id,
    ])
  ).rows;
  const participants = (
    await tx.query(
      'SELECT * FROM chat.participants WHERE conversation_id=$1 ORDER BY id' + suffix,
      [id],
    )
  ).rows;
  const states = (
    await tx.query(
      'SELECT * FROM chat.user_conversation_states WHERE conversation_id=$1 ORDER BY user_id' +
        suffix,
      [id],
    )
  ).rows;
  const hidden = (
    await tx.query(
      'SELECT h.* FROM chat.hidden_messages h JOIN chat.messages m ON m.id=h.message_id WHERE m.conversation_id=$1 ORDER BY h.message_id,h.user_id',
      [id],
    )
  ).rows;
  const references = [];
  for (const [table, columns, where] of [...directReferences, ...extraReferences]) {
    const rows = (
      await tx.query(
        `SELECT * FROM ${table} WHERE ${where ?? 'conversation_id=$1'} ORDER BY ${table.endsWith('model_blocked_messages') ? 'seq' : 'id'}${suffix}`,
        [id],
      )
    ).rows;
    references.push({ table, columns, rows });
  }
  return { conversation, messages, participants, states, hidden, references };
}

async function assertDrained(tx, id) {
  for (const table of ['ai_runtime.reply_plans', 'ai_runtime.group_reply_plans']) {
    const result = await tx.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE conversation_id=$1 AND status NOT IN ('done','cancelled')`,
      [id],
    );
    invariant(result.rows[0].n === 0, 'ACTIVE_REPLY_MUST_DRAIN');
  }
  const pending = await tx.query(
    `SELECT
    (SELECT count(*) FROM ai_runtime.call_memory_jobs WHERE conversation_id=$1 AND status='pending') +
    (SELECT count(*) FROM ai_runtime.private_digests WHERE conversation_id=$1 AND status IN ('pending','failed')) +
    (SELECT count(*) FROM ai_runtime.group_memory_states WHERE conversation_id=$1 AND (pending_count>0 OR lease_id IS NOT NULL)) +
    (SELECT count(*) FROM ai_runtime.memory_states WHERE conversation_id=$1 AND (pending_count>0 OR fact_trigger_seq>cursor_seq)) +
    (SELECT count(*) FROM ai_runtime.chat_summary_states s JOIN ai_runtime.memory_states m ON m.id=s.parent_id WHERE m.conversation_id=$1 AND (s.target_seq>s.covered_seq OR s.lease_id IS NOT NULL)) AS n`,
    [id],
  );
  invariant(Number(pending.rows[0].n) === 0, 'MEMORY_WORK_MUST_DRAIN');
  const channels = await tx.query(
    `SELECT
    (SELECT count(*) FROM channels.outbound_messages o JOIN chat.messages m ON m.id=o.chat_message_id
      WHERE m.conversation_id=$1 AND o.status IN ('pending','retry','sending')) +
    (SELECT count(*) FROM platform.outbox WHERE event_type='chat.message_created' AND dispatched_at IS NULL
      AND event->'payload'->>'conversationId'=$1::text) AS n`,
    [id],
  );
  invariant(Number(channels.rows[0].n) === 0, 'CHANNEL_DELIVERY_MUST_DRAIN');
}

async function insertMessageBatch(tx, rows, crypto, owner) {
  const ciphertexts = await crypto.sealMany(
    owner,
    rows.map((row) => ({ aad: `chat:message:${row.id}`, plaintext: JSON.stringify(row.content) })),
    tx,
  );
  const values = [],
    slots = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const data = [
      row.id,
      row.conversation_id,
      row.seq,
      row.sender_participant_id,
      row.sender_kind,
      row.client_msg_id,
      ciphertexts[index],
      row.quote_message_id,
      'normal',
      row.scope,
      utc(row.created_at),
      row.content.type,
    ];
    slots.push(
      '(' +
        data
          .map((value) => {
            values.push(value);
            return '$' + values.length;
          })
          .join(',') +
        ')',
    );
  }
  await tx.query(
    `INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,quote_message_id,status,scope,created_at,content_type) VALUES ${slots.join(',')}`,
    values,
  );
}

/** All message changes and cursor translations are one transaction per conversation.
 * The reviewed snapshot is re-read under locks. Changed target state is a refusal, not a merge.
 */
export async function applyFastConversation({
  database,
  execution,
  execute = false,
  sourceDigest,
  ...args
}) {
  validateConversationPlan(args.plan, args.validateContent, args.options ?? {});
  invariant(args.plan.sourceDigest === sourceDigest, 'FAST_SOURCE_DIGEST_MISMATCH');
  if (!execute) return { mode: 'plan', inserted: args.plan.newMessages.length };
  await assertFastExecution(database, execution, args.plan.digest, sourceDigest);
  return database.transaction((tx) => applyConversationTransaction(tx, args));
}

function validateConversationPlan(plan, validateContent, options) {
  assertMigrationOwnersAllowed(
    [
      plan.ownerUserId,
      ...plan.newMessages.flatMap((row) => migrationOwnersOf(row, row.owner_user_id)),
      ...plan.states.map((row) => row.user_id),
      ...plan.participants.filter((row) => row.kind === 'user').map((row) => row.ref_id),
    ],
    options,
  );
  const { digest, ...payload } = plan;
  invariant(digest === fingerprint(payload), 'PLAN_DIGEST_MISMATCH');
  invariant(plan.conflicts.length === 0, 'PLAN_HAS_UNRESOLVED_CONFLICTS');
  invariant(typeof validateContent === 'function', 'CONTRACT_VALIDATOR_REQUIRED');
}

async function lockConversationScope(tx, plan) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('migration:' || $1,0))", [
    plan.ownerUserId,
  ]);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:user:' || $1,0))", [
    plan.ownerUserId,
  ]);
  await tx.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('ai_runtime:conversation:' || $1,0))",
    [plan.conversationId],
  );
  await tx.query('SELECT id FROM chat.conversations WHERE id=$1 FOR UPDATE', [plan.conversationId]);
  // Compatible with the live update-log lock; no event or historical message is broadcast.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('realtime:' || $1,0))", [
    plan.ownerUserId,
  ]);
}

/** Read/lock only. This entry never creates receipts or writes business rows. */
export async function readConversationExecutionBaseline(tx, plan, options = {}) {
  await lockConversationScope(tx, plan);
  const baseline = await readConversationBaseline(tx, plan.conversationId, true);
  assertMigrationOwnersAllowed(
    [
      baseline.conversation.owner_user_id,
      ...baseline.states.map((row) => row.user_id),
      ...baseline.participants.filter((row) => row.kind === 'user').map((row) => row.ref_id),
      ...baseline.hidden.map((row) => row.user_id),
    ],
    options,
  );
  invariant(
    baseline.conversation.owner_user_id === plan.ownerUserId,
    'MIGRATION_OWNER_SCOPE_MISMATCH',
  );
  const account = await tx.query('SELECT status FROM identity.users WHERE id=$1', [
    plan.ownerUserId,
  ]);
  invariant(account.rows[0]?.status === 'active', 'TARGET_ACCOUNT_NOT_ACTIVE');
  await assertDrained(tx, plan.conversationId);
  return baseline;
}

/** Private transaction body copied from the tested conversation executor. */
async function applyConversationTransaction(
  tx,
  { plan, crypto, validateContent, fault, options = {} },
) {
  const baseline = await readConversationExecutionBaseline(tx, plan, options);
  invariant(fingerprint(baseline) === plan.baseline, 'TARGET_CHANGED_REPLAN_REQUIRED');
  if (!plan.changed) return { status: 'unchanged', inserted: 0 };
  invariant(
    Number.isSafeInteger(plan.lastSeq) && plan.lastSeq < 2147483647,
    'SEQUENCE_RANGE_REQUIRES_REVIEW',
  );
  const participants = new Map(baseline.participants.map((row) => [row.id, row.kind]));
  for (const row of plan.newMessages) {
    validateContent(row.content);
    invariant(
      row.sender_kind === 'system'
        ? row.sender_participant_id === baseline.conversation.system_participant_id
        : participants.get(row.sender_participant_id) === row.sender_kind,
      'SENDER_NOT_IN_CONVERSATION',
    );
  }
  const offset = plan.lastSeq + 1;
  await tx.query(
    'CREATE TEMP TABLE migration_seq_map(id uuid PRIMARY KEY, old_seq bigint UNIQUE, new_seq bigint UNIQUE) ON COMMIT DROP',
  );
  for (let start = 0; start < plan.remap.length; start += 1000) {
    const batch = plan.remap.slice(start, start + 1000);
    await tx.query(
      'INSERT INTO migration_seq_map SELECT * FROM unnest($1::uuid[],$2::bigint[],$3::bigint[])',
      [batch.map((row) => row.id), batch.map((row) => row.oldSeq), batch.map((row) => row.newSeq)],
    );
  }
  // A positive temporary range avoids both the unique index and the seq>0 constraint.
  await tx.query('UPDATE chat.messages SET seq=seq+$2 WHERE conversation_id=$1', [
    plan.conversationId,
    offset,
  ]);
  await fault?.('after_sequence_shift');
  await tx.query(
    'UPDATE chat.messages m SET seq=x.new_seq FROM migration_seq_map x WHERE m.id=x.id',
  );
  for (let start = 0; start < plan.newMessages.length; start += 200)
    await insertMessageBatch(
      tx,
      plan.newMessages.slice(start, start + 200),
      crypto,
      plan.ownerUserId,
    );
  const newSeq = new Map(plan.remap.map((row) => [row.id, row.newSeq]));
  const oldRows = baseline.messages;
  const mapBoundary = (value) =>
    value === null ? null : translateBoundary(value, oldRows, newSeq);
  const oldSeq = new Map(plan.remap.map((row) => [row.oldSeq, row.newSeq]));
  const exactReference = (row, idColumn, value) => {
    if (value === null) return null;
    invariant(
      row[idColumn] && newSeq.has(row[idColumn]),
      'MISSING_REFERENCED_MESSAGE_REQUIRES_REVIEW',
    );
    return newSeq.get(row[idColumn]);
  };
  for (const { table, columns, rows } of baseline.references) {
    if (table === 'ai_runtime.model_blocked_messages') {
      await tx.query(`UPDATE ${table} SET seq=seq+$2 WHERE conversation_id=$1`, [
        plan.conversationId,
        offset,
      ]);
      for (const row of rows) {
        const mapped = row.message_id
          ? exactReference(row, 'message_id', row.seq)
          : oldSeq.get(Number(row.seq));
        invariant(mapped !== undefined, 'MISSING_BLOCKED_MESSAGE_REQUIRES_REVIEW');
        await tx.query(`UPDATE ${table} SET seq=$3 WHERE conversation_id=$1 AND seq=$2`, [
          plan.conversationId,
          Number(row.seq) + offset,
          mapped,
        ]);
      }
    } else {
      for (const row of rows) {
        if (table === 'ai_runtime.memory_states')
          invariant(
            !Number(row.barrier_seq) || oldSeq.has(Number(row.barrier_seq)),
            'MEMORY_BARRIER_GAP_REQUIRES_REVIEW',
          );
        await tx.query(
          `UPDATE ${table} SET ${columns.map((column, index) => `${column}=$${index + 2}`).join(',')} WHERE id=$1`,
          [
            row.id,
            ...columns.map((column) =>
              table === 'library.favorites'
                ? exactReference(row, 'source_id', row[column])
                : mapBoundary(row[column]),
            ),
          ],
        );
      }
    }
  }
  for (const state of plan.states)
    await tx.query(
      'UPDATE chat.user_conversation_states SET read_seq=$3,cleared_through_seq=$4 WHERE conversation_id=$1 AND user_id=$2',
      [plan.conversationId, state.user_id, state.read_seq, state.cleared_through_seq],
    );
  for (const participant of plan.participants)
    await tx.query('UPDATE chat.participants SET read_seq=$2 WHERE id=$1', [
      participant.id,
      participant.read_seq,
    ]);
  await tx.query('UPDATE chat.conversations SET last_seq=$2 WHERE id=$1', [
    plan.conversationId,
    plan.lastSeq,
  ]);
  // Every old cursor, even the previous latest cursor, must rebuild. Keep retained update
  // ciphertext for audit; move the retention boundary over a deliberately empty sequence.
  await tx.query(
    `INSERT INTO realtime.user_update_cursors(user_id,last_update_seq,trimmed_through) VALUES($1,1,1)
    ON CONFLICT(user_id) DO UPDATE SET last_update_seq=realtime.user_update_cursors.last_update_seq+1,trimmed_through=realtime.user_update_cursors.last_update_seq+1`,
    [plan.ownerUserId],
  );
  await fault?.('before_receipt');
  return { status: 'applied', inserted: plan.newMessages.length };
}
