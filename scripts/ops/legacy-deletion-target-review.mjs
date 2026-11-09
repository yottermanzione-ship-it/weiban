import { createHash } from 'node:crypto';
import { legacyId } from './legacy-content-rules.mjs';
import policy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
export const DELETION_METADATA_QUERIES = Object.freeze([
  'SELECT m.id,m.conversation_id,c.owner_user_id,c.last_seq,(SELECT max(n.seq) FROM chat.messages n WHERE n.conversation_id=c.id) AS max_seq FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE m.id=ANY($1::uuid[])',
  'SELECT id,conversation_id FROM chat.messages WHERE conversation_id=ANY($1::uuid[])',
]);
export async function completeDeletionFamilies(
  client,
  source,
  preservedDigests,
  { maxCandidates = 2000000 } = {},
) {
  const excluded = new Set([...policy.userIdSha256, ...preservedDigests]);
  const preserved = (owner) =>
    excluded.has(
      createHash('sha256')
        .update('user:' + String(owner).trim().toLowerCase())
        .digest('hex'),
    );
  const refs = new Map(
    source.fragments.filter((ref) => !preserved(ref.ownerId)).map((ref) => [ref.messageId, ref]),
  );
  const detail = {
    mediaFamilies: source.mediaFamilies.length,
    completedMediaFamilies: 0,
    missingFirstFragment: 0,
    ownerMismatch: 0,
    boundUnverified: 0,
    scanBudgetExceeded: 0,
    derivedCandidates: 0,
    additionalFragments: 0,
  };
  const families = source.mediaFamilies.filter((family) => !preserved(family.ownerId));
  detail.preservedFamilies = source.mediaFamilies.length - families.length;
  if (!families.length) return { fragments: [...refs.values()], detail };
  const { rows: first } = await client.query(DELETION_METADATA_QUERIES[0], [
    families.map((f) => f.firstMessageId),
  ]);
  const allowed = [];
  for (const family of families) {
    const row = first.find((r) => r.id === family.firstMessageId);
    if (!row) {
      detail.missingFirstFragment++;
      continue;
    }
    const hash = createHash('sha256')
      .update('user:' + String(row.owner_user_id).trim().toLowerCase())
      .digest('hex');
    if (row.owner_user_id !== family.ownerId || excluded.has(hash)) {
      detail.ownerMismatch++;
      continue;
    }
    const bound = Number(row.last_seq);
    if (!Number.isSafeInteger(bound) || bound < 1 || bound < Number(row.max_seq)) {
      detail.boundUnverified++;
      continue;
    }
    if (detail.derivedCandidates + bound > maxCandidates) {
      detail.scanBudgetExceeded++;
      continue;
    }
    detail.derivedCandidates += bound;
    allowed.push({ family, row, bound });
  }
  const convs = [...new Set(allowed.map((r) => r.row.conversation_id))];
  const { rows } = convs.length
    ? await client.query(DELETION_METADATA_QUERIES[1], [convs])
    : { rows: [] };
  const byId = new Map(rows.map((row) => [row.id, row]));
  // Original importer assigned consecutive parts and monotonically increasing seq values.
  // last_seq therefore bounds every possible original part, even when a row is now hidden.
  for (const { family, row, bound } of allowed) {
    for (let part = 0; part < bound; part++) {
      const id = legacyId('message', family.table, family.sourceId, part);
      if (byId.get(id)?.conversation_id !== row.conversation_id) continue;
      if (!refs.has(id)) detail.additionalFragments++;
      refs.set(id, {
        messageId: id,
        clientId: legacyId('client-message', family.table, family.sourceId, part),
        ownerId: family.ownerId,
        fullSourceScope: true,
      });
    }
    detail.completedMediaFamilies++;
  }
  return { fragments: [...refs.values()], detail };
}
export function targetDeletionSql(fragments, wrapTransaction = true) {
  const hex = Buffer.from(JSON.stringify(fragments)).toString('hex');
  const sql = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='5s';
WITH refs AS (SELECT * FROM jsonb_to_recordset(convert_from(decode('${hex}','hex'),'UTF8')::jsonb) AS x("messageId" uuid,"clientId" text,"ownerId" uuid,"fullSourceScope" boolean)),
found AS (SELECT r.*,m.id,m.client_msg_id,m.conversation_id,m.seq,m.status,c.owner_user_id,c.archived_at,
coalesce(s.cleared_through_seq,0) AS cleared,coalesce(s.hidden,false) AS conversation_hidden,
EXISTS(SELECT 1 FROM chat.hidden_messages h WHERE h.message_id=m.id AND h.user_id=r."ownerId") AS hidden
FROM refs r LEFT JOIN chat.messages m ON m.id=r."messageId" LEFT JOIN chat.conversations c ON c.id=m.conversation_id LEFT JOIN chat.user_conversation_states s ON s.conversation_id=c.id AND s.user_id=r."ownerId")
SELECT json_build_object('candidateFragments',count(*),'foundFragments',count(id),
'ownerMismatch',count(*) FILTER(WHERE id IS NOT NULL AND owner_user_id IS DISTINCT FROM "ownerId"),
'sourceIdentityMismatch',count(*) FILTER(WHERE id IS NOT NULL AND client_msg_id IS DISTINCT FROM "clientId"),
'visibleMessageFragments',count(*) FILTER(WHERE id IS NOT NULL AND status='normal' AND NOT hidden AND seq>cleared),
'inHiddenOrArchivedConversation',count(*) FILTER(WHERE id IS NOT NULL AND (conversation_hidden OR archived_at IS NOT NULL)),
'fullSourceScopeFragments',count(*) FILTER(WHERE id IS NOT NULL AND "fullSourceScope"),
'quoteReferences',(SELECT count(*) FROM chat.messages q JOIN found f ON q.quote_message_id=f.id),
'favoriteReferences',(SELECT count(*) FROM library.favorites v JOIN found f ON v.conversation_id=f.conversation_id AND v.source_seq=f.seq)) FROM found;
ROLLBACK;`;
  return wrapTransaction ? sql : sql.slice(sql.indexOf('WITH refs'), sql.lastIndexOf('ROLLBACK;'));
}
