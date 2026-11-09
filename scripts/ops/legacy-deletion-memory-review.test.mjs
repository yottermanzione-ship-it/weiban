import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  memoryReferenceClassification,
  inspectDeletionMemoryReferences,
} from './legacy-deletion-memory-review.mjs';
import { openLab, addFixtureUser, addFixtureConversation, cutoff } from './legacy-delta-lab.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
test('source references distinguish current/past/unknown; no semantic matching of private content', () => {
  const id = randomUUID(),
    ids = new Set([id]);
  assert.equal(
    memoryReferenceClassification(
      { status: 'current', sourceMessageIds: [id], content: 'PRIVATE_CANARY' },
      ids,
    ),
    'current_direct_reference',
  );
  assert.equal(
    memoryReferenceClassification({ status: 'past', sourceMessageIds: [id] }, ids),
    'past_direct_reference',
  );
  assert.equal(
    memoryReferenceClassification({ status: 'current', sourceMessageIds: [] }, ids),
    'current_without_source_ids',
  );
  assert.equal(
    memoryReferenceClassification({ status: 'current', sourceMessageIds: [randomUUID()] }, ids),
    'other_source_reference',
  );
  assert.equal(
    memoryReferenceClassification({ status: 'current', sourceMessageIds: ['bad'] }, ids),
    'invalid_payload',
  );
});
test('actual readonly PG/crypto review limits scope, clears plaintext and reports exact references separately from coverage', async () => {
  const url = process.env.MIGRATION_DELETION_REVIEW_DATABASE_URL;
  if (!url) throw new Error('DEDICATED_MEMORY_REVIEW_DATABASE_REQUIRED');
  const lab = await openLab(url);
  try {
    const owner = (await addFixtureUser(lab)).id,
      conv = await addFixtureConversation(lab, { owner, oldCount: 2 });
    const rows = (
      await lab.database.query(
        'SELECT id FROM chat.messages WHERE conversation_id=$1 ORDER BY seq',
        [conv.id],
      )
    ).rows;
    const id = rows[0].id,
      plain = [];
    for (const sourceMessageIds of [[id], [], [rows[1].id]]) {
      const mid = randomUUID(),
        cipher = await lab.crypto.seal(
          owner,
          `ai:memory:${mid}`,
          JSON.stringify({ status: 'current', sourceMessageIds, content: 'PRIVATE_CANARY' }),
        );
      await lab.database.query(
        "INSERT INTO ai_runtime.memories(id,user_id,character_id,conversation_id,scope,ciphertext,created_at,updated_at) VALUES($1,$2,$3,$4,'normal',$5,$6,$6)",
        [mid, owner, conv.peer, conv.id, cipher, cutoff],
      );
    }
    const crypto = {
      async open(...args) {
        const buffer = await lab.crypto.open(...args);
        plain.push(buffer);
        return buffer;
      },
    };
    const reader = await lab.database.pool.connect();
    try {
      await reader.query('BEGIN READ ONLY');
      const result = await inspectDeletionMemoryReferences(
        reader,
        crypto,
        [{ ownerId: owner, messageId: id }],
        [],
      );
      assert.equal(result.memoryRows, 3);
      assert.equal(result.current_direct_reference, 1);
      assert.equal(result.current_without_source_ids, 1);
      assert.equal(result.other_source_reference, 1);
      assert.equal(result.provenanceComplete, false);
      assert.ok(
        !JSON.stringify(result).includes('PRIVATE_CANARY') &&
          !JSON.stringify(result).includes(owner),
      );
      assert.ok(plain.every((buffer) => buffer.every((byte) => byte === 0)));
      const protectedResult = await inspectDeletionMemoryReferences(
        reader,
        crypto,
        [{ ownerId: owner, messageId: id }],
        [legacyMigrationOwnerDigest(owner)],
      );
      assert.equal(protectedResult.memoryRows, 0);
      assert.equal(plain.length, 3);
      await reader.query('ROLLBACK');
    } finally {
      reader.release();
    }
  } finally {
    await lab.close();
  }
});
