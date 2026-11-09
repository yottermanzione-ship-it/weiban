import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { targetDeletionSql } from './legacy-deletion-readonly-audit.mjs';
import { completeDeletionFamilies } from './legacy-deletion-target-review.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
import { openLab, addFixtureUser, addFixtureConversation, cutoff } from './legacy-delta-lab.mjs';
test('actual target SQL compares text client keys, checks owners and visibility, counts references without changing data', async () => {
  const url = process.env.MIGRATION_DELETION_REVIEW_DATABASE_URL;
  if (!url) throw new Error('DEDICATED_DELETION_REVIEW_DATABASE_REQUIRED');
  const lab = await openLab(url);
  try {
    const owner = (await addFixtureUser(lab)).id,
      foreign = (await addFixtureUser(lab)).id;
    const conversation = await addFixtureConversation(lab, { owner, oldCount: 4 });
    const { rows } = await lab.database.query(
      'SELECT id,client_msg_id,seq FROM chat.messages WHERE conversation_id=$1 ORDER BY seq',
      [conversation.id],
    );
    await lab.database.query('INSERT INTO chat.hidden_messages(message_id,user_id) VALUES($1,$2)', [
      rows[0].id,
      owner,
    ]);
    await lab.database.query('UPDATE chat.messages SET quote_message_id=$1 WHERE id=$2', [
      rows[1].id,
      rows[3].id,
    ]);
    await lab.database.query('UPDATE chat.conversations SET archived_at=$1 WHERE id=$2', [
      cutoff,
      conversation.id,
    ]);
    const favorite = randomUUID();
    const sealed = await lab.crypto.seal(
      owner,
      `library:favorite:${favorite}`,
      JSON.stringify({ type: 'text', text: 'Synthetic favorite kept after original deletion' }),
    );
    await lab.database.query(
      "INSERT INTO library.favorites(id,user_id,source_kind,source_id,conversation_id,content_ciphertext,content_type,extra_images,scope,labels,source_created_at,source_seq,created_at) VALUES($1,$2,'message',$3,$4,$5,'text','{}','normal','{}',$6,2,$6)",
      [favorite, owner, rows[1].id, conversation.id, sealed, cutoff],
    );
    const fingerprint = async () =>
      createHash('sha256')
        .update(
          JSON.stringify(
            (
              await lab.database.query(
                'SELECT * FROM chat.messages WHERE conversation_id=$1 ORDER BY seq',
                [conversation.id],
              )
            ).rows,
          ),
        )
        .digest('hex');
    const before = await fingerprint();
    const refs = rows.slice(0, 3).map((row, i) => ({
      messageId: row.id,
      clientId: i === 2 ? randomUUID() : row.client_msg_id,
      ownerId: i === 2 ? foreign : owner,
      fullSourceScope: true,
    }));
    const client = await lab.database.pool.connect();
    try {
      const results = await client.query(targetDeletionSql(refs));
      const value = results.find((r) => r.rows?.[0]?.json_build_object)?.rows[0].json_build_object;
      assert.deepEqual(value, {
        candidateFragments: 3,
        foundFragments: 3,
        ownerMismatch: 1,
        sourceIdentityMismatch: 1,
        visibleMessageFragments: 2,
        inHiddenOrArchivedConversation: 3,
        fullSourceScopeFragments: 3,
        quoteReferences: 1,
        favoriteReferences: 1,
      });
    } finally {
      client.release();
    }
    assert.equal(await fingerprint(), before);
    assert.deepEqual(
      (
        await lab.database.query('SELECT content_ciphertext FROM library.favorites WHERE id=$1', [
          favorite,
        ])
      ).rows[0].content_ciphertext,
      sealed,
    );
  } finally {
    await lab.close();
  }
});

test('media families include later stable fragments even across a gap; budget and owner exclusions do not pretend completion', async () => {
  const url = process.env.MIGRATION_DELETION_REVIEW_DATABASE_URL;
  if (!url) throw new Error('DEDICATED_DELETION_REVIEW_DATABASE_REQUIRED');
  const lab = await openLab(url);
  try {
    const owner = (await addFixtureUser(lab)).id;
    const conversation = await addFixtureConversation(lab, { owner, oldCount: 0 });
    const table = 'group_messages',
      sourceId = randomUUID();
    for (const part of [0, 2]) {
      const id = legacyId('message', table, sourceId, part),
        clientId = legacyId('client-message', table, sourceId, part);
      const sealed = await lab.crypto.seal(
        owner,
        `chat:message:${id}`,
        JSON.stringify({ type: 'text', text: 'Synthetic original media fallback' }),
      );
      await lab.database.query(
        "INSERT INTO chat.messages(id,conversation_id,seq,sender_participant_id,sender_kind,client_msg_id,content_ciphertext,status,scope,content_type,created_at) VALUES($1,$2,$3,$4,'character',$5,$6,'normal','normal','text',$7)",
        [id, conversation.id, part + 1, conversation.peerParticipant, clientId, sealed, cutoff],
      );
    }
    await lab.database.query('UPDATE chat.conversations SET last_seq=4 WHERE id=$1', [
      conversation.id,
    ]);
    const firstMessageId = legacyId('message', table, sourceId, 0);
    const source = {
      fragments: [
        {
          messageId: firstMessageId,
          clientId: legacyId('client-message', table, sourceId, 0),
          ownerId: owner,
          fullSourceScope: false,
        },
      ],
      mediaFamilies: [{ table, sourceId, ownerId: owner, firstMessageId }],
    };
    const client = await lab.database.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await completeDeletionFamilies(client, source, []);
      assert.equal(result.detail.completedMediaFamilies, 1);
      assert.equal(result.detail.additionalFragments, 1);
      assert.deepEqual(
        result.fragments.map((f) => f.messageId).sort(),
        [0, 2].map((part) => legacyId('message', table, sourceId, part)).sort(),
      );
      assert.ok(result.fragments.every((f) => f.fullSourceScope));
      const bounded = await completeDeletionFamilies(client, source, [], { maxCandidates: 0 });
      assert.equal(bounded.detail.completedMediaFamilies, 0);
      assert.equal(bounded.detail.scanBudgetExceeded, 1);
      const preserved = await completeDeletionFamilies(
        {
          query() {
            throw new Error('must not query');
          },
        },
        source,
        [legacyMigrationOwnerDigest(owner)],
      );
      assert.equal(preserved.fragments.length, 0);
      assert.equal(preserved.detail.preservedFamilies, 1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } finally {
    await lab.close();
  }
});
