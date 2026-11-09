/** Read-only helper, also evaluated in the running app container. Never imports the app module. */
import { createHash } from 'node:crypto';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const FIRST_CUTOFF = Date.parse('2026-10-24T12:02:47.053609Z');
export async function inspectSupplementShapes(reader, crypto, refs, preservedDigests) {
  if (
    !Array.isArray(refs) ||
    refs.length > 2000 ||
    !Array.isArray(preservedDigests) ||
    !preservedDigests.length
  )
    throw new Error('READ_REVIEW_SCOPE_REQUIRED');
  const results = [];
  for (const ref of refs) {
    if (
      !UUID.test(ref.userId ?? '') ||
      !UUID.test(ref.characterId ?? '') ||
      !Number.isSafeInteger(ref.index)
    )
      throw new Error('READ_REVIEW_SCOPE_INVALID');
    const hash = createHash('sha256')
      .update('user:' + ref.userId.trim().toLowerCase())
      .digest('hex');
    if (preservedDigests.includes(hash)) {
      results.push({ index: ref.index, kind: 'preserved_owner' });
      continue;
    }
    const row = (
      await reader.query(
        "SELECT s.text_ciphertext,s.updated_at FROM characters.user_supplements s JOIN identity.users u ON u.id=s.user_id AND u.status='active' WHERE s.user_id=$1 AND s.character_id=$2",
        [ref.userId, ref.characterId],
      )
    ).rows[0];
    if (!row) {
      results.push({ index: ref.index, kind: 'unavailable' });
      continue;
    }
    let plaintext;
    try {
      plaintext = await crypto.open(
        ref.userId,
        `characters:supplement:${ref.userId}:${ref.characterId}`,
        row.text_ciphertext,
        reader,
      );
      const text = plaintext.toString('utf8').trim();
      const updated =
        row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at);
      const kind =
        text === '[object Object]'
          ? Number.isFinite(updated) && updated <= FIRST_CUTOFF
            ? 'placeholder_before_first_cutoff'
            : 'placeholder_after_or_unknown'
          : text
            ? 'other_text'
            : 'empty';
      results.push({
        index: ref.index,
        kind,
        sourceTimeMatches: updated === Date.parse(ref.sourceUpdatedAt),
      });
    } catch {
      results.push({ index: ref.index, kind: 'read_failed' });
    } finally {
      plaintext?.fill(0);
    }
  }
  return results;
}
export async function runRemoteSupplementReview(preservedDigests, refs, dependencies) {
  let client, ring;
  let stage = 'configuration';
  try {
    const { pg, loadConfig, loadKekRing, EnvelopeCrypto } = dependencies;
    const config = loadConfig();
    ring = loadKekRing(config);
    stage = 'connection';
    client = new pg.Client({
      connectionString: config.database.url,
      options:
        '-c default_transaction_read_only=on -c statement_timeout=5000 -c idle_in_transaction_session_timeout=15000',
    });
    await client.connect();
    stage = 'begin';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const crypto = new EnvelopeCrypto(
      client,
      { now: () => new Date(), nowMs: () => Date.now() },
      ring,
    );
    stage = 'inspection';
    const result = await inspectSupplementShapes(client, crypto, refs, preservedDigests);
    stage = 'rollback';
    await client.query('ROLLBACK');
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch {
    process.stdout.write(
      JSON.stringify({ ok: false, category: 'SUPPLEMENT_READ_REVIEW_FAILED', stage }) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  }
}
