import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mediaUnresolvedTargetSql } from './legacy-media-readonly-audit.mjs';
import { openLab, addFixtureUser, addFixtureConversation, cutoff } from './legacy-delta-lab.mjs';
test('actual readonly target media joins keep owner conflicts separate from ready metadata, with no content reads', async () => {
  const url = process.env.MIGRATION_DELETION_REVIEW_DATABASE_URL;
  if (!url) throw new Error('DEDICATED_MEDIA_REVIEW_DATABASE_REQUIRED');
  const lab = await openLab(url);
  try {
    const owner = (await addFixtureUser(lab)).id,
      other = (await addFixtureUser(lab)).id;
    const conv = await addFixtureConversation(lab, { owner, oldCount: 1 });
    const message = (
      await lab.database.query('SELECT id FROM chat.messages WHERE conversation_id=$1', [conv.id])
    ).rows[0].id;
    const media = randomUUID();
    await lab.database.query(
      "INSERT INTO media.objects(id,owner_id,purpose,mime_type,size_bytes,width,height,storage_key,state,created_at) VALUES($1,$2,'chat_image','image/png',1,1,1,$3,'ready',$4)",
      [media, owner, 'synthetic-review/' + media, cutoff],
    );
    const client = await lab.database.pool.connect();
    try {
      const result = await client.query(
        mediaUnresolvedTargetSql([
          { category: 'missing', ownerId: owner, messageId: message, mediaIds: [media] },
          { category: 'no_reference', ownerId: other, messageId: message, mediaIds: [media] },
        ]),
      );
      const rows = result.find((r) => r.rows.length)?.rows[0]?.coalesce;
      assert.equal(rows.find((r) => r.category === 'missing').target_media_ready, 1);
      assert.equal(rows.find((r) => r.category === 'missing').existing_text_placeholder, 1);
      assert.equal(rows.find((r) => r.category === 'no_reference').message_wrong_owner, 1);
      assert.equal(rows.find((r) => r.category === 'no_reference').media_wrong_owner, 1);
      assert.equal(rows.find((r) => r.category === 'no_reference').target_media_ready, 0);
      assert.equal(
        (await client.query('SELECT count(*)::int AS n FROM media.objects WHERE id=$1', [media]))
          .rows[0].n,
        1,
      );
    } finally {
      client.release();
    }
    assert.throws(
      () =>
        mediaUnresolvedTargetSql([
          { category: 'missing', ownerId: owner, messageId: "'bad", mediaIds: [] },
        ]),
      /MEDIA_REFERENCE_INVALID/,
    );
  } finally {
    await lab.close();
  }
});
