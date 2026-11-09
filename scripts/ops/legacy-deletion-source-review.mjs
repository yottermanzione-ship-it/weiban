/** Derived identifiers only; no raw private fields leave this module's review result. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { legacyId, legacyMessageContents } from './legacy-content-rules.mjs';
import { utc } from './legacy-delta-core.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export { UUID as LEGACY_REVIEW_UUID };
const INITIAL = '2026-10-24T12:02:47.053609Z';
export function deletionFragmentReview(rows, preservedDigests, cutoff) {
  const summary = {
    sourceRows: 0,
    preservedRows: 0,
    textSources: 0,
    mediaSourcesNeedingOriginalSplitProof: 0,
    sourceOutsideWindow: 0,
    messageDeletionScope: 0,
    conversationDeletionScope: 0,
    unknownDeletionScope: 0,
  };
  const fragments = [],
    mediaFamilies = [];
  for (const row of rows) {
    if (!UUID.test(row.ownerId ?? '')) throw new Error('DELETION_OWNER_REQUIRED');
    const ownerDigest = createHash('sha256')
      .update('user:' + row.ownerId.trim().toLowerCase())
      .digest('hex');
    if (preservedDigests.includes(ownerDigest)) {
      summary.preservedRows++;
      continue;
    }
    if (
      !['chat_history', 'group_messages'].includes(row.table) ||
      typeof row.id !== 'string' ||
      !row.id ||
      row.id.length > 200
    )
      throw new Error('DELETION_SOURCE_INVALID');
    if (
      utc(row.created_at) > utc(INITIAL) ||
      utc(row.deleted_at) <= utc(INITIAL) ||
      utc(row.deleted_at) > utc(cutoff)
    ) {
      summary.sourceOutsideWindow++;
      continue;
    }
    summary.sourceRows++;
    summary[
      row.deletion_scope === 'message'
        ? 'messageDeletionScope'
        : row.deletion_scope === 'conversation'
          ? 'conversationDeletionScope'
          : 'unknownDeletionScope'
    ]++;
    const media = ['image', 'voice', 'sticker'].includes(row.message_type);
    if (media)
      mediaFamilies.push({
        table: row.table,
        sourceId: row.id,
        ownerId: row.ownerId,
        firstMessageId: legacyId('message', row.table, row.id, 0),
      });
    if (media) summary.mediaSourcesNeedingOriginalSplitProof++;
    else summary.textSources++;
    const count = media ? 1 : legacyMessageContents(row, null).length;
    if (count > 1024) throw new Error('DELETION_FRAGMENT_SCOPE_TOO_LARGE');
    for (let part = 0; part < count; part++)
      fragments.push({
        messageId: legacyId('message', row.table, row.id, part),
        clientId: legacyId('client-message', row.table, row.id, part),
        ownerId: row.ownerId,
        fullSourceScope: !media,
      });
  }
  return { summary, fragments, mediaFamilies };
}
export function runSourceDeletionReadReview(preservedDigests, cutoff, queryOverride) {
  const query =
    queryOverride ??
    ((sql) => {
      const r = spawnSync(
        'sqlite3',
        ['-readonly', '-batch', '-cmd', '.timeout 5000', '/opt/weiban-server/weiban.db'],
        {
          input: 'PRAGMA query_only=ON;\nBEGIN;\n' + sql + '\nROLLBACK;\n',
          encoding: 'utf8',
          timeout: 15000,
          maxBuffer: 128 * 1024 * 1024,
        },
      );
      if (r.status !== 0) throw new Error('SOURCE_READ_FAILED');
      return r.stdout.trim()
        ? r.stdout
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
    });
  const users = query("SELECT json_object('id',id) FROM app_users;");
  if (users.some((r) => !UUID.test(r.id ?? ''))) throw new Error('SOURCE_OWNER_SCOPE_INVALID');
  const allowed = users
    .map((r) => r.id)
    .filter(
      (id) =>
        !preservedDigests.includes(
          createHash('sha256')
            .update('user:' + id.trim().toLowerCase())
            .digest('hex'),
        ),
    );
  const owners = JSON.stringify(allowed),
    all = [];
  for (const table of ['chat_history', 'group_messages']) {
    const columns = new Set(
      query(`SELECT json_object('name',name) FROM pragma_table_info('${table}');`).map(
        (r) => r.name,
      ),
    );
    if (!['id', 'created_at', 'deleted_at', 'content'].every((key) => columns.has(key)))
      throw new Error('SOURCE_SCHEMA_INCOMPLETE');
    const owner = table === 'chat_history' ? 'm.user_id' : 'g.user_id';
    const join = table === 'group_messages' ? ' JOIN chat_groups g ON g.id=m.group_id' : '';
    const senderScope =
      table === 'group_messages' && columns.has('user_id')
        ? ` AND (coalesce(m.user_id,'')='' OR m.user_id IN (SELECT value FROM json_each('${owners}')))`
        : '';
    const pairs = [
      'message_type',
      'content',
      'quoted_content',
      'quoted_author',
      'created_at',
      'deleted_at',
      'deletion_scope',
    ]
      .map((key) => `'${key}',${columns.has(key) ? 'm.' + key : "''"}`)
      .join(',');
    const rows =
      query(`SELECT json_object('table','${table}','id',CAST(m.id AS TEXT),'ownerId',${owner},${pairs}) FROM ${table} m${join}
WHERE ${owner} IN (SELECT value FROM json_each('${owners}'))
${senderScope}
AND julianday(m.created_at)<=julianday('${INITIAL}') AND julianday(m.deleted_at)>julianday('${INITIAL}') AND julianday(m.deleted_at)<=julianday('${utc(cutoff)}');`);
    all.push(...rows);
  }
  return deletionFragmentReview(all, preservedDigests, cutoff);
}
