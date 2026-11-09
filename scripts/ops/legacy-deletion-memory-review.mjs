/** Deterministic source-reference check only. Does not show or interpret memory content. */
import { createHash } from 'node:crypto';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function memoryReferenceClassification(payload, sourceIds) {
  if (
    !payload ||
    !Array.isArray(payload.sourceMessageIds) ||
    !['current', 'past'].includes(payload.status) ||
    payload.sourceMessageIds.some((id) => !UUID.test(id))
  )
    return 'invalid_payload';
  if (payload.sourceMessageIds.some((id) => sourceIds.has(id)))
    return payload.status === 'current' ? 'current_direct_reference' : 'past_direct_reference';
  if (!payload.sourceMessageIds.length)
    return payload.status === 'current' ? 'current_without_source_ids' : 'past_without_source_ids';
  return 'other_source_reference';
}
export async function inspectDeletionMemoryReferences(reader, crypto, refs, preservedDigests) {
  if (
    !Array.isArray(refs) ||
    refs.length > 2000 ||
    refs.some((r) => !UUID.test(r.messageId) || !UUID.test(r.ownerId))
  )
    throw new Error('MEMORY_REFERENCE_SCOPE_INVALID');
  const allowed = refs.filter(
    (r) =>
      !preservedDigests.includes(
        createHash('sha256')
          .update('user:' + r.ownerId.toLowerCase())
          .digest('hex'),
      ),
  );
  const messages = (
    await reader.query(
      `WITH refs AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r("messageId" uuid,"ownerId" uuid)) SELECT m.id,m.conversation_id,m.seq,c.owner_user_id,c.character_id FROM refs r JOIN chat.messages m ON m.id=r."messageId" JOIN chat.conversations c ON c.id=m.conversation_id AND c.owner_user_id=r."ownerId"`,
      [JSON.stringify(allowed.map(({ messageId, ownerId }) => ({ messageId, ownerId })))],
    )
  ).rows;
  const conversations = [...new Set(messages.map((m) => m.conversation_id))],
    sourceIds = new Set(messages.map((m) => m.id));
  const result = {
    matchedMessages: messages.length,
    affectedConversations: conversations.length,
    memoryRows: 0,
    current_direct_reference: 0,
    past_direct_reference: 0,
    current_without_source_ids: 0,
    past_without_source_ids: 0,
    other_source_reference: 0,
    invalid_payload: 0,
    decrypt_failed: 0,
    summaryStatesCoveringDeletedRows: 0,
    rollingSummariesCoveringDeletedRows: 0,
    provenanceComplete: false,
    semanticComparisonPerformed: false,
    writes: false,
    privateValuesReturned: false,
  };
  if (!conversations.length) return result;
  const memories = (
    await reader.query(
      'SELECT m.id,m.user_id,m.conversation_id,m.ciphertext FROM ai_runtime.memories m JOIN chat.conversations c ON c.id=m.conversation_id AND c.owner_user_id=m.user_id WHERE m.conversation_id=ANY($1::uuid[])',
      [conversations],
    )
  ).rows;
  if (memories.length > 10000) throw new Error('MEMORY_REFERENCE_SCOPE_TOO_LARGE');
  result.memoryRows = memories.length;
  for (const row of memories) {
    let bytes;
    try {
      bytes = await crypto.open(row.user_id, `ai:memory:${row.id}`, row.ciphertext, reader);
      const payload = JSON.parse(bytes.toString('utf8'));
      result[memoryReferenceClassification(payload, sourceIds)]++;
    } catch {
      result.decrypt_failed++;
    } finally {
      bytes?.fill(0);
    }
  }
  const summary = (
    await reader.query(
      `WITH refs AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,conversation_id uuid,seq bigint)) SELECT
(SELECT count(*)::int FROM ai_runtime.memory_states s WHERE s.conversation_id=ANY($2::uuid[]) AND (s.summary_ciphertext IS NOT NULL OR s.daily_summaries_ciphertext IS NOT NULL OR s.monthly_summaries_ciphertext IS NOT NULL OR s.window_block_ciphertext IS NOT NULL) AND EXISTS(SELECT 1 FROM refs r WHERE r.conversation_id=s.conversation_id AND r.seq<=greatest(s.cursor_seq,s.window_start_seq) AND r.seq>s.barrier_seq)) AS legacy,
(SELECT count(*)::int FROM ai_runtime.chat_summary_states s JOIN ai_runtime.memory_states p ON p.id=s.parent_id WHERE p.conversation_id=ANY($2::uuid[]) AND s.ciphertext IS NOT NULL AND EXISTS(SELECT 1 FROM refs r WHERE r.conversation_id=p.conversation_id AND r.seq<=s.covered_seq AND r.seq>p.barrier_seq)) AS rolling`,
      [
        JSON.stringify(
          messages.map(({ id, conversation_id, seq }) => ({ id, conversation_id, seq })),
        ),
        conversations,
      ],
    )
  ).rows[0];
  result.summaryStatesCoveringDeletedRows = summary.legacy;
  result.rollingSummariesCoveringDeletedRows = summary.rolling;
  result.provenanceComplete =
    result.current_without_source_ids === 0 &&
    result.past_without_source_ids === 0 &&
    result.invalid_payload === 0 &&
    result.decrypt_failed === 0 &&
    summary.legacy === 0 &&
    summary.rolling === 0;
  return result;
}
export async function runRemoteDeletionMemoryReview(
  refs,
  preservedDigests,
  { pg, loadConfig, loadKekRing, EnvelopeCrypto },
) {
  let client,
    ring,
    stage = 'configuration';
  try {
    const config = loadConfig();
    ring = loadKekRing(config);
    stage = 'connection';
    client = new pg.Client({
      connectionString: config.database.url,
      options:
        '-c default_transaction_read_only=on -c statement_timeout=5000 -c idle_in_transaction_session_timeout=15000',
    });
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    stage = 'inspection';
    const crypto = new EnvelopeCrypto(
      client,
      { now: () => new Date(), nowMs: () => Date.now() },
      ring,
    );
    const result = await inspectDeletionMemoryReferences(client, crypto, refs, preservedDigests);
    stage = 'rollback';
    await client.query('ROLLBACK');
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        category: 'DELETION_MEMORY_REVIEW_FAILED',
        stage,
        writes: false,
        privateValuesReturned: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}
