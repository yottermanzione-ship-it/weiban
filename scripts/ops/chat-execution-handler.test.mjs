/** Retained synthetic PG only. No shared reset, real snapshot, worker, model, or external media. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import {
  openLab,
  addFixtureUser,
  addFixtureConversation,
  fixturePlan,
  validateContent,
  maintenance,
  initialCutoff,
  cutoff,
} from './legacy-delta-lab.mjs';
import {
  applyConversationDelta,
  applyExecutionConversationDelta,
  readConversationBaseline,
} from './legacy-delta-db.mjs';
import { fingerprint } from './legacy-delta-core.mjs';
import { legacyId } from './legacy-content-rules.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';
import { createChatExecutionHandler } from './chat-execution-handler.mjs';
import {
  buildExecutionManifest,
  createMigrationExecutionKernel,
  executionDigest,
  executionPolicyDigest,
  readExecutionDatabaseFacts,
} from './migration-execution-ledger.mjs';
import {
  assertExecutionFixture,
  initializeExecutionFixture,
  createExecutionFixtureProbes,
} from './migration-execution-ledger-fixture.mjs';

const url = 'postgres://postgres@127.0.0.1:56389/codex_migration_execution_1109';
const hash = executionDigest,
  codeSha = 'b'.repeat(40),
  writers = ['legacy-api', 'new-api', 'legacy-workers', 'new-workers', 'channels', 'payments'];
const matches = (code) => (error) => error?.code === code || error?.message === code;
const strip = ({ digest: _digest, ...value }) => value;

test(
  'formal chat handler with real schema, crypto, ledger and retained synthetic source rows',
  { timeout: 240_000 },
  async (suite) => {
    let lab;
    let sourceSeed = 10_000;
    const cases = [];
    try {
      const guard = new Database({ url });
      try {
        await assertExecutionFixture(guard);
      } finally {
        await guard.close();
      }
      lab = await openLab(url);
      const db = lab.database;
      await initializeExecutionFixture(db);
      await db.query(
        'CREATE TABLE IF NOT EXISTS codex_execution_fixture.chat_sources(source_key text PRIMARY KEY,data jsonb NOT NULL)',
      );
      await db.query(
        'CREATE TABLE IF NOT EXISTS codex_execution_fixture.chat_media_reviews(proof_digest text PRIMARY KEY,proof jsonb NOT NULL)',
      );
      const reader = Object.freeze({
        mode: 'rehearsal',
        digest: hash('chat-source-real-fixture-pg-reader-with-reviewed-media-v2'),
        async read({ sourceKey, tx }) {
          const row = (
            await tx.query(
              'SELECT data FROM codex_execution_fixture.chat_sources WHERE source_key=$1',
              [sourceKey],
            )
          ).rows[0];
          if (!row) throw new Error('CHAT_FIXTURE_SOURCE_MISSING');
          return row.data;
        },
        async readMediaReview({ proofDigest, tx }) {
          return (
            (
              await tx.query(
                'SELECT proof FROM codex_execution_fixture.chat_media_reviews WHERE proof_digest=$1 FOR SHARE',
                [proofDigest],
              )
            ).rows[0]?.proof ?? null
          );
        },
      });
      const handlerFor = (options = {}, extra = {}) =>
        createChatExecutionHandler({
          mode: 'rehearsal',
          sourceReader: reader,
          crypto: lab.crypto,
          validateContent,
          options,
          ...extra,
        });
      const kernelFor = (f, database = db, handler = f.handler) =>
        createMigrationExecutionKernel({
          database,
          target: f.target,
          mode: 'rehearsal',
          probes: f.proofs.probes,
          authorizationVerifier: f.proofs.authorizationVerifier,
          handlers: [handler],
          options: f.options,
        });
      async function finish(f) {
        const row = (
          await db.query('SELECT status FROM platform.legacy_migration_runs WHERE run_id=$1', [
            f.manifest.runId,
          ])
        ).rows[0];
        if (row && ['prepared', 'executing', 'verified'].includes(row.status)) {
          await f.proofs.configure(f.manifest);
          await kernelFor(f).halt(f.manifest);
        }
      }
      async function scenario({
        type = 'direct',
        owner,
        setup,
        options = {},
        fault,
        groupOwnerMissing = false,
      } = {}) {
        const user = await addFixtureUser(lab, owner);
        const fixture = await addFixtureConversation(lab, {
          owner: user.id,
          type,
          protectedState: true,
          seed: (sourceSeed += 100),
        });
        if (setup) await setup(fixture);
        const sourceKey = hash(randomUUID()),
          snapshotDigest = hash(randomUUID()),
          groupId = randomUUID();
        const table = type === 'group' ? 'group_messages' : 'chat_history';
        const rows = [0, 1, 2].map((index) => ({
          id:
            type === 'group'
              ? [randomUUID(), `opaque_${randomUUID()}`, randomUUID()][index]
              : String(fixture.seed + index + 1),
          ...(type === 'group'
            ? { group_id: groupId, sender_type: 'character', user_id: '' }
            : { user_id: user.id, role: 'assistant' }),
          message_type: 'text',
          content: `虚构迁移片段 ${index}`,
          created_at:
            type === 'group'
              ? '2026-11-08T00:00:01.000Z'
              : `2026-11-08T00:00:0${index * 2 + 1}.000Z`,
        }));
        const data = {
          snapshotDigest,
          table,
          rows,
          group:
            type === 'group' ? { id: groupId, user_id: groupOwnerMissing ? '' : user.id } : null,
          bindings: rows.map((row) => ({
            sourceId: row.id,
            ownerUserId: user.id,
            legacyOwnerUserId: user.id,
            conversationId: fixture.id,
            userParticipantId: fixture.userParticipant,
            peerParticipantId: fixture.peerParticipant,
            peerKind: 'character',
            systemParticipantId: fixture.system,
          })),
          review: {
            initialCutoff,
            cutoff,
            inventory: {
              complete: true,
              digest: hash('synthetic-deletion-review'),
              sourceDigest: snapshotDigest,
            },
            protection: {},
          },
        };
        await db.query('INSERT INTO codex_execution_fixture.chat_sources VALUES($1,$2::jsonb)', [
          sourceKey,
          JSON.stringify(data),
        ]);
        const handler = handlerFor(options, { fault });
        const planned = await db.transaction((tx) => handler.prepare(tx, { sourceKey }));
        const facts = await readExecutionDatabaseFacts(db);
        const target = { connectionString: url, digest: facts.targetDigest };
        const manifest = buildExecutionManifest({
          runId: randomUUID(),
          targetDigest: facts.targetDigest,
          sourceDigest: snapshotDigest,
          schemaDigest: facts.schemaDigest,
          policyDigest: executionPolicyDigest(options),
          codeSha,
          inventoryDigest: hash({ writers, domains: ['chat-history'] }),
          backupSetDigest: hash({ fixture: sourceKey }),
          receiptJournalIdDigest: hash('synthetic-payment-journal'),
          requiredDomains: ['chat-history'],
          writerIds: writers,
          units: [planned.unit],
        });
        const proofs = await createExecutionFixtureProbes(db);
        await proofs.configure(manifest);
        const result = {
          fixture,
          user,
          data,
          sourceKey,
          handler,
          options,
          payload: planned.payload,
          manifest,
          target,
          proofs,
          saveSource: async () =>
            db.query(
              'UPDATE codex_execution_fixture.chat_sources SET data=$2::jsonb WHERE source_key=$1',
              [sourceKey, JSON.stringify(data)],
            ),
          baseline: () => readConversationBaseline(db, fixture.id),
        };
        result.kernel = kernelFor(result);
        result.apply = () =>
          result.kernel.executeUnit(result.manifest, result.manifest.units[0].key, result.payload);
        cases.push(result);
        return result;
      }
      async function prepare(f) {
        await f.kernel.prepare(f.manifest);
      }
      async function approveMissing(f, reviewed) {
        const entries = new Map(
          (f.data.review.missingMediaReviews ?? []).map((review) => [review.sourceId, review]),
        );
        for (const { index, reason } of reviewed) {
          const raw = f.data.rows[index];
          const scope = {
            version: 1,
            sourceDigest: f.data.snapshotDigest,
            table: f.data.table,
            sourceId: String(raw.id),
            ownerUserId: f.user.id,
            sourceRowDigest: fingerprint(raw),
            reason,
          };
          const proof = {
            ...scope,
            kind: 'legacy-missing-media-review',
            decision: 'retain-text-unavailable',
            authorityDigest: hash('synthetic-approved-retain-text-decision'),
            evidenceDigest: hash({
              sourceKey: f.sourceKey,
              index,
              reason,
              rowDigest: scope.sourceRowDigest,
            }),
          };
          const proofDigest = fingerprint(proof);
          await db.query(
            'INSERT INTO codex_execution_fixture.chat_media_reviews VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',
            [proofDigest, JSON.stringify(proof)],
          );
          entries.set(scope.sourceId, { ...scope, proofDigest });
        }
        f.data.review.missingMediaReviews = [...entries.values()];
        await f.saveSource();
      }
      async function replan(f) {
        const planned = await db.transaction((tx) =>
          f.handler.prepare(tx, { sourceKey: f.sourceKey }),
        );
        assert.equal(planned.status, 'planned');
        f.payload = planned.payload;
        f.manifest = buildExecutionManifest({
          ...strip(f.manifest),
          sourceDigest: planned.sourceDigest,
          units: [planned.unit],
        });
        await f.proofs.configure(f.manifest);
        return planned;
      }
      const counts = async () =>
        (
          await db.query(`SELECT (SELECT count(*) FROM public.codex_migration_receipts)::int fixture,
        (SELECT count(*) FROM platform.outbox)::int outbox,(SELECT count(*) FROM model_access.usage_records)::int usage,
        (SELECT count(*) FROM billing.ledger_entries)::int charges`)
        ).rows[0];

      await suite.test(
        'real private chat history preserves existing ciphertext, deletion flags, references, password and no side effects',
        async () => {
          const f = await scenario({
            setup: async (fixture) => {
              const baseline = await readConversationBaseline(db, fixture.id),
                memoryId = randomUUID(),
                summaryId = randomUUID();
              await db.query('INSERT INTO chat.hidden_messages(message_id,user_id) VALUES($1,$2)', [
                baseline.messages[2].id,
                fixture.owner,
              ]);
              await db.query(
                "UPDATE chat.messages SET status='recalled',content_ciphertext=NULL,recalled_at=$2 WHERE id=$1",
                [baseline.messages[3].id, cutoff],
              );
              await db.query(
                'INSERT INTO ai_runtime.memory_states(id,user_id,character_id,conversation_id,barrier_seq,cursor_seq,window_start_seq,fact_trigger_seq,updated_at) VALUES($1,$2,$3,$4,1,2,1,2,$5)',
                [memoryId, fixture.owner, fixture.peer, fixture.id, cutoff],
              );
              await db.query(
                "INSERT INTO ai_runtime.chat_summary_states(id,parent_id,scope,covered_seq,target_seq,updated_at) VALUES($1,$2,'normal',2,2,$3)",
                [summaryId, memoryId, cutoff],
              );
              await db.query(
                'INSERT INTO ai_runtime.chat_summary_versions(id,state_id,version,from_seq,to_seq,ciphertext,created_at) VALUES($1,$2,1,1,2,$3,$4)',
                [randomUUID(), summaryId, Buffer.from('synthetic-memory'), cutoff],
              );
              await db.query(
                "INSERT INTO ai_runtime.model_blocked_messages(conversation_id,seq,user_id,character_id,message_id,source) VALUES($1,2,$2,$3,$4,'manual')",
                [fixture.id, fixture.owner, fixture.peer, baseline.messages[1].id],
              );
              await db.query(
                "INSERT INTO library.favorites(id,user_id,source_kind,source_id,conversation_id,content_ciphertext,content_type,source_created_at,created_at,source_seq) VALUES($1,$2,'message',$3,$4,$5,'text',$6,$6,2)",
                [
                  randomUUID(),
                  fixture.owner,
                  baseline.messages[1].id,
                  fixture.id,
                  Buffer.from('synthetic-favorite'),
                  cutoff,
                ],
              );
              await db.query(
                "INSERT INTO channels.bindings(id,user_id,channel,slot,status,character_id,character_name,generation,context_token_sealed,reply_conversation_id,reply_after_seq,created_at,updated_at) VALUES($1,$2,'weibo','main','active',$3,'虚构',4,$4,$5,2,$6,$6)",
                [
                  randomUUID(),
                  fixture.owner,
                  fixture.peer,
                  Buffer.from('synthetic-channel'),
                  fixture.id,
                  cutoff,
                ],
              );
            },
          });
          try {
            const before = await f.baseline(),
              sideEffects = await counts();
            await prepare(f);
            // No nested transaction/connection is used by the handler: the real crypto receives tx.
            const transaction = db.transaction.bind(db);
            let nested = false,
              inside = false;
            db.transaction = async (fn) => {
              if (inside) nested = true;
              inside = true;
              try {
                return await transaction(fn);
              } finally {
                inside = false;
              }
            };
            try {
              assert.deepEqual(await f.apply(), { status: 'applied', counts: { inserted: 3 } });
            } finally {
              db.transaction = transaction;
            }
            assert.equal(nested, false);
            const after = await f.baseline();
            assert.deepEqual(
              after.messages.map((row) => Number(row.seq)),
              [1, 2, 3, 4, 5, 6, 7],
            );
            for (const row of before.messages)
              assert.deepEqual(
                after.messages.find((item) => item.id === row.id).content_ciphertext,
                row.content_ciphertext,
              );
            assert.equal(after.hidden.length, 1);
            assert.equal(after.messages.at(-1).status, 'recalled');
            assert.equal(after.states[0].hidden, true);
            assert.equal(after.states[0].cleared_through_seq, '2');
            assert.equal(after.states[0].read_seq, '4');
            const ref = (table) => after.references.find((entry) => entry.table === table).rows[0];
            assert.equal(ref('ai_runtime.memory_states').cursor_seq, '4');
            assert.equal(ref('ai_runtime.chat_summary_versions').to_seq, '4');
            assert.equal(ref('ai_runtime.model_blocked_messages').seq, '4');
            assert.equal(ref('library.favorites').source_seq, 4);
            assert.equal(ref('channels.bindings').reply_after_seq, '4');
            assert.equal(ref('channels.bindings').generation, 5);
            const plain = await lab.crypto.open(
              f.user.id,
              `chat:message:${f.payload.plan.newMessages[0].id}`,
              after.messages[0].content_ciphertext,
            );
            try {
              assert.deepEqual(JSON.parse(plain.toString()), f.payload.plan.newMessages[0].content);
            } finally {
              plain.fill(0);
            }
            assert.deepEqual(await counts(), sideEffects);
            assert.equal(
              (await db.query('SELECT password_hash FROM identity.users WHERE id=$1', [f.user.id]))
                .rows[0].password_hash,
              f.user.hash,
            );
            assert.equal((await f.apply()).status, 'already_applied');
            assert.deepEqual(await f.kernel.reconcile(f.manifest, async () => f.payload), {
              committed: 1,
              retryable: 0,
              waiting: 0,
            });
            const receipt = (
              await db.query(
                'SELECT manifest::text FROM platform.legacy_migration_runs WHERE run_id=$1',
                [f.manifest.runId],
              )
            ).rows[0].manifest;
            assert(!receipt.includes(f.data.rows[0].content));
            assert(!receipt.includes(f.user.id));
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'same-time group UUID and opaque IDs keep source-stable message/client IDs and real group owner',
        async () => {
          const f = await scenario({ type: 'group' });
          try {
            await prepare(f);
            await f.apply();
            for (const raw of f.data.rows) {
              const row = (await f.baseline()).messages.find(
                (item) => item.id === legacyId('message', 'group_messages', raw.id, 0),
              );
              assert.equal(
                row.client_msg_id,
                legacyId('client-message', 'group_messages', raw.id, 0),
              );
            }
            const expected = f.data.rows
              .map((row) => row.id)
              .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
            assert.deepEqual(
              f.payload.plan.newMessages.map((row) => row.source.id),
              expected,
            );
            assert.equal((await f.apply()).status, 'already_applied');
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'image readiness/ownership/purpose are real PG dependencies and all text fragments keep stable IDs',
        async () => {
          const f = await scenario(),
            mediaId = randomUUID();
          f.data.rows[0].message_type = 'image';
          f.data.rows[0].content = '虚构说明'.repeat(1200);
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('MEDIA_NOT_READY_OR_WRONG_OWNER'),
          );
          f.data.bindings[0].mediaId = mediaId;
          await f.saveSource();
          await db.query(
            "INSERT INTO media.objects(id,owner_id,purpose,mime_type,size_bytes,width,height,storage_key,state,created_at) VALUES($1,$2,'chat_image','image/webp',9,1,1,$3,'pending',$4)",
            [mediaId, f.user.id, `synthetic/${mediaId}`, cutoff],
          );
          const replan = () =>
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey }));
          await assert.rejects(replan(), matches('CHAT_MEDIA_DEPENDENCY_NOT_READY'));
          await db.query("UPDATE media.objects SET state='ready',owner_id=$2 WHERE id=$1", [
            mediaId,
            randomUUID(),
          ]);
          await assert.rejects(replan(), matches('CHAT_MEDIA_DEPENDENCY_NOT_READY'));
          await db.query(
            "UPDATE media.objects SET owner_id=$2,purpose='generated_voice' WHERE id=$1",
            [mediaId, f.user.id],
          );
          await assert.rejects(replan(), matches('MEDIA_PURPOSE_MISMATCH'));
          await db.query("UPDATE media.objects SET purpose='chat_image' WHERE id=$1", [mediaId]);
          const planned = await replan();
          assert.deepEqual(
            planned.payload.plan.newMessages.slice(0, 3).map((row) => row.content.type),
            ['image', 'text', 'text'],
          );
          f.payload = planned.payload;
          f.manifest = buildExecutionManifest({ ...strip(f.manifest), units: [planned.unit] });
          await f.proofs.configure(f.manifest);
          try {
            await prepare(f);
            assert.equal((await f.apply()).counts.inserted, 5);
            const actual = await f.baseline();
            for (let part = 0; part < 3; part++)
              assert(
                actual.messages.some(
                  (row) => row.id === legacyId('message', 'chat_history', f.data.rows[0].id, part),
                ),
              );
            assert.equal((await f.apply()).status, 'already_applied');
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'reviewed missing voice/image/no-reference preserve exact text, quotes, timestamps and all stable fragments',
        async () => {
          const f = await scenario();
          f.data.rows[0].message_type = 'voice';
          f.data.rows[0].audio_url = '/synthetic/missing-voice.ogg';
          f.data.rows[0].content = '合成语音原转录';
          f.data.rows[1].message_type = 'image';
          f.data.rows[1].image_url = '/synthetic/missing-image.webp';
          f.data.rows[1].content = '合成图片说明🙂'.repeat(1100);
          f.data.rows[1].quoted_author = '合成引用角色';
          f.data.rows[1].quoted_content = '完整引用🙂'.repeat(850);
          f.data.bindings[1].quoteMessageId = f.payload.baseline.messages[0].id;
          f.data.rows[2].message_type = 'image';
          f.data.rows[2].content = '没有附件引用也保留此文字';
          await approveMissing(f, [
            { index: 0, reason: 'missing_file' },
            { index: 1, reason: 'missing_file' },
            { index: 2, reason: 'no_reference' },
          ]);
          const planned = await replan(f),
            messages = planned.payload.plan.newMessages,
            expected = messages.length;
          assert(expected > 5);
          assert(
            messages.every((row) => row.content.type === 'text' && row.source.mediaUnavailable),
          );
          for (const raw of f.data.rows) {
            const parts = messages.filter((row) => row.source.id === raw.id);
            assert(
              parts[0].content.text.startsWith(
                raw.message_type === 'voice' ? '[旧语音附件不可用]' : '[旧图片附件不可用]',
              ),
            );
            assert(
              parts.every(
                (row, index) =>
                  row.created_at === raw.created_at &&
                  row.source.part === index &&
                  row.id === legacyId('message', 'chat_history', raw.id, index),
              ),
            );
          }
          const imageParts = messages.filter((row) => row.source.id === f.data.rows[1].id);
          assert.equal(
            imageParts.map((row) => row.content.text).join(''),
            `[旧图片附件不可用] \n↪ 合成引用角色：${f.data.rows[1].quoted_content}\n${f.data.rows[1].content}`,
          );
          assert(
            imageParts.every((row) => row.quote_message_id === f.payload.baseline.messages[0].id),
          );
          const sideEffects = await counts();
          try {
            await prepare(f);
            assert.equal((await f.apply()).counts.inserted, expected);
            const after = await f.baseline();
            assert.equal(after.messages.length, 4 + expected);
            const restored = await lab.crypto.openMany(
              f.user.id,
              messages.map((row) => ({
                aad: `chat:message:${row.id}`,
                sealed: after.messages.find((target) => target.id === row.id).content_ciphertext,
              })),
            );
            try {
              restored.forEach((plain, index) =>
                assert.deepEqual(JSON.parse(plain.toString()), messages[index].content),
              );
            } finally {
              restored.forEach((plain) => plain.fill(0));
            }
            assert.equal((await f.apply()).status, 'already_applied');
            assert.deepEqual(await f.kernel.reconcile(f.manifest, async () => f.payload), {
              committed: 1,
              retryable: 0,
              waiting: 0,
            });
            assert.deepEqual(await counts(), sideEffects);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM platform.legacy_migration_events WHERE run_id=$1',
                  [f.manifest.runId],
                )
              ).rows[0].n,
              expected + 3,
            );
            // A discovered file does not overwrite text or append a new variant of the same source.
            const mediaId = randomUUID();
            await db.query(
              "INSERT INTO media.objects(id,owner_id,purpose,mime_type,size_bytes,width,height,storage_key,state,created_at) VALUES($1,$2,'chat_voice','audio/ogg',9,NULL,NULL,$3,'ready',$4)",
              [mediaId, f.user.id, `synthetic/recovered-${mediaId}`, cutoff],
            );
            f.data.bindings[0].mediaId = mediaId;
            await f.saveSource();
            await assert.rejects(
              db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
              matches('MISSING_MEDIA_REVIEW_BINDING_CONFLICT'),
            );
            f.data.review.missingMediaReviews = f.data.review.missingMediaReviews.filter(
              (review) => review.sourceId !== f.data.rows[0].id,
            );
            await f.saveSource();
            await assert.rejects(
              db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
              matches('CHAT_MEDIA_REPAIR_REVIEW_REQUIRED'),
            );
            assert.equal((await f.baseline()).messages.length, 4 + expected);
            assert.deepEqual(await counts(), sideEffects);
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'missing-media proof must be read back and bound to unchanged raw source before actual PG writes',
        async () => {
          const f = await scenario({ type: 'group' });
          f.data.rows[0].message_type = 'voice';
          f.data.rows[0].media_path = '/synthetic/missing-group-voice.ogg';
          await approveMissing(f, [{ index: 0, reason: 'missing_file' }]);
          await replan(f);
          const noProofReader = handlerFor(
            {},
            { sourceReader: { ...reader, readMediaReview: undefined } },
          );
          await assert.rejects(
            db.transaction((tx) => noProofReader.prepare(tx, { sourceKey: f.sourceKey })),
            matches('CHAT_MISSING_MEDIA_PROOF_READER_REQUIRED'),
          );
          const before = fingerprint(await f.baseline()),
            review = f.data.review.missingMediaReviews[0];
          try {
            await prepare(f);
            f.data.rows[0].content = 'source drift must not be normalized away';
            await f.saveSource();
            await assert.rejects(f.apply(), matches('MISSING_MEDIA_REVIEW_SOURCE_MISMATCH'));
            f.data.rows[0].content = '虚构迁移片段 0';
            await f.saveSource();
            await db.query(
              "UPDATE codex_execution_fixture.chat_media_reviews SET proof=jsonb_set(proof,'{evidenceDigest}',to_jsonb($2::text)) WHERE proof_digest=$1",
              [review.proofDigest, hash('tampered-proof')],
            );
            await assert.rejects(f.apply(), matches('CHAT_MISSING_MEDIA_PROOF_INVALID'));
            assert.equal(fingerprint(await f.baseline()), before);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM platform.legacy_migration_events WHERE run_id=$1',
                  [f.manifest.runId],
                )
              ).rows[0].n,
              0,
            );
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'reviewed fallback cannot bypass preserved owner, foreign/pending media, wrong reason or a changed proof owner',
        async () => {
          const f = await scenario();
          f.data.rows[0].message_type = 'image';
          f.data.rows[0].media_path = '/synthetic/missing-image.webp';
          await approveMissing(f, [{ index: 0, reason: 'missing_file' }]);
          await replan(f);
          const protectedHandler = handlerFor({
            additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(f.user.id)],
          });
          await assert.rejects(
            db.transaction((tx) => protectedHandler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('LEGACY_MIGRATION_OWNER_PRESERVED'),
          );
          const proof = f.data.review.missingMediaReviews[0];
          f.data.review.missingMediaReviews[0] = { ...proof, ownerUserId: randomUUID() };
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('MISSING_MEDIA_REVIEW_SOURCE_MISMATCH'),
          );
          f.data.review.missingMediaReviews[0] = { ...proof, reason: 'no_reference' };
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('MISSING_MEDIA_REASON_CONFLICT'),
          );
          f.data.review.missingMediaReviews[0] = proof;
          const mediaId = randomUUID();
          f.data.bindings[0].mediaId = mediaId;
          await f.saveSource();
          await db.query(
            "INSERT INTO media.objects(id,owner_id,purpose,mime_type,size_bytes,width,height,storage_key,state,created_at) VALUES($1,$2,'chat_image','image/webp',9,1,1,$3,'pending',$4)",
            [mediaId, f.user.id, `synthetic/conflict-${mediaId}`, cutoff],
          );
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('CHAT_MEDIA_DEPENDENCY_NOT_READY'),
          );
          await db.query("UPDATE media.objects SET owner_id=$2,state='ready' WHERE id=$1", [
            mediaId,
            randomUUID(),
          ]);
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('CHAT_MEDIA_DEPENDENCY_NOT_READY'),
          );
          await db.query('UPDATE media.objects SET owner_id=$2 WHERE id=$1', [mediaId, f.user.id]);
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('MISSING_MEDIA_REVIEW_BINDING_CONFLICT'),
          );
          assert.equal((await f.baseline()).messages.length, 4);
        },
      );

      await suite.test(
        'source deletion review and departed/archived target remain protected; missing relation is a blocked prerequisite',
        async () => {
          const f = await scenario({ type: 'group' });
          f.data.review.protection.permanentlyDeleted = true;
          await f.saveSource();
          assert.deepEqual(
            await db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            { status: 'unchanged', unit: null, payload: null },
          );
          f.data.review.protection.permanentlyDeleted = false;
          f.data.rows[0].deleted_at = cutoff;
          await f.saveSource();
          await db.query('UPDATE chat.conversations SET archived_at=$2 WHERE id=$1', [
            f.fixture.id,
            cutoff,
          ]);
          await db.query(
            "UPDATE chat.participants SET left_at=$2 WHERE conversation_id=$1 AND kind='user'",
            [f.fixture.id, cutoff],
          );
          const planned = await db.transaction((tx) =>
            f.handler.prepare(tx, { sourceKey: f.sourceKey }),
          );
          f.payload = planned.payload;
          f.manifest = buildExecutionManifest({ ...strip(f.manifest), units: [planned.unit] });
          await f.proofs.configure(f.manifest);
          try {
            await prepare(f);
            assert.equal((await f.apply()).counts.inserted, 2);
            const actual = await f.baseline();
            assert(actual.conversation.archived_at);
            assert(actual.participants.find((row) => row.kind === 'user').left_at);
            assert(
              !actual.messages.some(
                (row) => row.id === legacyId('message', 'group_messages', f.data.rows[0].id, 0),
              ),
            );
            f.data.bindings.forEach((row) => {
              row.conversationId = randomUUID();
            });
            const missing = randomUUID();
            f.data.bindings.forEach((row) => {
              row.conversationId = missing;
            });
            await f.saveSource();
            await assert.rejects(
              db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
              matches('CONVERSATION_NOT_FOUND'),
            );
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'source reader missing/prod-mode spoof and ordinary or forged transaction are blocked',
        async () => {
          assert.throws(
            () =>
              createChatExecutionHandler({
                mode: 'production',
                sourceReader: reader,
                crypto: lab.crypto,
                validateContent,
              }),
            /CHAT_SOURCE_READER_REQUIRED/,
          );
          assert.throws(
            () =>
              createChatExecutionHandler({
                mode: 'production',
                crypto: lab.crypto,
                validateContent,
              }),
            /CHAT_SOURCE_READER_REQUIRED/,
          );
          const f = await scenario();
          await assert.rejects(
            db.transaction((tx) => f.handler.apply(tx, f.payload)),
            matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
          );
          await assert.rejects(
            f.handler.apply(
              {
                query() {
                  throw new Error('SHOULD_NOT_QUERY');
                },
              },
              f.payload,
            ),
            matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
          );
          await assert.rejects(
            db.transaction((tx) =>
              applyExecutionConversationDelta(
                tx,
                { plan: f.payload.plan, crypto: lab.crypto, validateContent },
                {
                  scopeDigest: f.manifest.units[0].scopeDigest,
                  handlerDigest: f.handler.digest,
                  policyDigest: executionPolicyDigest(),
                },
              ),
            ),
            matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
          );
          assert.equal((await f.baseline()).messages.length, 4);
        },
      );

      await suite.test(
        'original fixture entry refuses non-loopback, wrong pool and missing marker without opening transaction',
        async () => {
          const f = await scenario();
          let queries = 0,
            transactions = 0;
          const fake = {
            pool: { options: { connectionString: url } },
            query: async () => {
              queries++;
              return { rows: [] };
            },
            transaction: async () => {
              transactions++;
            },
          };
          await assert.rejects(
            applyConversationDelta({
              database: fake,
              target: {
                kind: 'isolated-fixture',
                synthetic: true,
                url: 'postgres://postgres@192.0.2.1/live',
              },
              plan: f.payload.plan,
              crypto: lab.crypto,
              validateContent,
              maintenance,
            }),
            /LOOPBACK_REQUIRED/,
          );
          await assert.rejects(
            applyConversationDelta({
              database: fake,
              target: {
                kind: 'isolated-fixture',
                synthetic: true,
                url: url.replace('execution', 'wrong'),
              },
              plan: f.payload.plan,
              crypto: lab.crypto,
              validateContent,
              maintenance,
            }),
            /DATABASE_CONNECTION_MISMATCH/,
          );
          assert.equal(queries, 0);
          assert.equal(transactions, 0);
          const target = { kind: 'isolated-fixture', synthetic: true, url };
          fake.query = async (sql) => {
            queries++;
            return {
              rows: sql.includes('current_database')
                ? [{ name: 'codex_migration_execution_1109' }]
                : [],
            };
          };
          await assert.rejects(
            applyConversationDelta({
              database: fake,
              target,
              plan: f.payload.plan,
              crypto: lab.crypto,
              validateContent,
              maintenance,
            }),
            /SYNTHETIC_DATABASE_MARKER_REQUIRED/,
          );
          assert.equal(transactions, 0);
          // Real old wrapper still executes its own strictly isolated path and receipt.
          const legacy = await addFixtureConversation(lab);
          assert.equal(
            (
              await applyConversationDelta({
                ...lab,
                plan: await fixturePlan(lab, legacy),
                validateContent,
                maintenance,
              })
            ).inserted,
            3,
          );
        },
      );

      await suite.test(
        'actual source owner preservation defeats declared mapping and target preservation defeats re-signed scope',
        async () => {
          const f = await scenario({ type: 'group' });
          const preserved = randomUUID(),
            options = { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(preserved)] };
          const guarded = handlerFor(options);
          f.data.group.user_id = preserved;
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => guarded.inspect(tx, f.payload)),
            matches('LEGACY_MIGRATION_OWNER_PRESERVED'),
          );
          f.data.group.user_id = f.user.id;
          await f.saveSource();
          await db.query('UPDATE chat.conversations SET owner_user_id=$2 WHERE id=$1', [
            f.fixture.id,
            preserved,
          ]);
          await assert.rejects(
            db.transaction((tx) => guarded.inspect(tx, f.payload)),
            matches('LEGACY_MIGRATION_OWNER_PRESERVED'),
          );
          assert.equal((await f.baseline()).messages.length, 4);
        },
      );

      await suite.test(
        'unknown/mismatched group owner and arbitrary cross-account mapping cannot derive a plan',
        async () => {
          const f = await scenario({ type: 'group' });
          f.data.group.user_id = '';
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('CHAT_GROUP_OWNER_PROOF_REQUIRED'),
          );
          f.data.group.user_id = f.user.id;
          f.data.bindings[0].ownerUserId = randomUUID();
          await f.saveSource();
          await assert.rejects(
            db.transaction((tx) => f.handler.prepare(tx, { sourceKey: f.sourceKey })),
            matches('CHAT_SOURCE_TARGET_IDENTITY_CONFLICT'),
          );
        },
      );

      await suite.test(
        'persisted source change, forged plan and actual target drift all refuse before business write',
        async () => {
          const f = await scenario();
          try {
            await prepare(f);
            f.data.rows[0].content = 'changed synthetic source';
            await f.saveSource();
            await assert.rejects(f.apply(), matches('CHAT_SOURCE_REVIEW_CHANGED'));
            f.data.rows[0].content = '虚构迁移片段 0';
            await f.saveSource();
            const bad = structuredClone(f.payload);
            bad.plan.newMessages[0].content.text = 'invented';
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, bad),
              matches('CHAT_PLAN_NOT_DERIVED_FROM_SOURCE'),
            );
            await db.query(
              'UPDATE chat.user_conversation_states SET muted=false WHERE conversation_id=$1',
              [f.fixture.id],
            );
            await assert.rejects(f.apply(), matches('TARGET_CHANGED_BEFORE_APPLY'));
            assert.equal((await f.baseline()).messages.length, 4);
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'mid-write fault rolls back sequence shifts, encryption, cursors and formal receipts; retry uses same plan',
        async () => {
          let armed = true;
          const f = await scenario({
            fault: async (stage) => {
              if (stage === 'before_receipt' && armed) {
                armed = false;
                throw new Error('CHAT_SYNTHETIC_FAULT');
              }
            },
          });
          try {
            const before = fingerprint(await f.baseline());
            await prepare(f);
            await assert.rejects(f.apply(), matches('CHAT_SYNTHETIC_FAULT'));
            assert.equal(fingerprint(await f.baseline()), before);
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM platform.legacy_migration_events WHERE run_id=$1',
                  [f.manifest.runId],
                )
              ).rows[0].n,
              0,
            );
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM realtime.user_update_cursors WHERE user_id=$1',
                  [f.user.id],
                )
              ).rows[0].n,
              0,
            );
            assert.equal(
              (await kernelFor(f).executeUnit(f.manifest, f.manifest.units[0].key, f.payload))
                .status,
              'applied',
            );
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test('concurrent callers cannot insert twice', async () => {
        let entered, release;
        const enteredPromise = new Promise((r) => {
            entered = r;
          }),
          releasePromise = new Promise((r) => {
            release = r;
          });
        const f = await scenario({
          fault: async (stage) => {
            if (stage === 'after_sequence_shift') {
              entered();
              await releasePromise;
            }
          },
        });
        try {
          await prepare(f);
          const first = f.apply();
          await enteredPromise;
          try {
            await assert.rejects(f.apply(), matches('EXECUTION_BUSY'));
          } finally {
            release();
          }
          assert.equal((await first).status, 'applied');
          assert.equal((await f.baseline()).messages.length, 7);
        } finally {
          release();
          await finish(f);
        }
      });

      await suite.test(
        'real COMMIT then backend loss recovers durable chat and ledger exactly once',
        async () => {
          const f = await scenario(),
            faulty = new Database({ url, onError: () => {} });
          faulty.pool.options.application_name = 'codex-chat-execution-ack-loss';
          let armed = true,
            killed = false;
          faulty.pool.on('connect', (client) => {
            const query = client.query.bind(client);
            client.query = (...args) => {
              if (args[0] !== 'COMMIT' || !armed) return query(...args);
              return (async () => {
                await query(...args);
                armed = false;
                const owned = (
                  await db.query(
                    'SELECT datname,application_name FROM pg_stat_activity WHERE pid=$1',
                    [client.processID],
                  )
                ).rows[0];
                assert.equal(owned.datname, 'codex_migration_execution_1109');
                assert.equal(owned.application_name, 'codex-chat-execution-ack-loss');
                killed = (
                  await db.query('SELECT pg_terminate_backend($1) killed', [client.processID])
                ).rows[0].killed;
                throw new Error('CHAT_ACK_LOST');
              })();
            };
          });
          try {
            await prepare(f);
            await assert.rejects(
              kernelFor(f, faulty).executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('ADAPTER_OR_CONNECTION_FAILURE'),
            );
            assert.equal(killed, true);
            assert.equal((await f.baseline()).messages.length, 7);
            const restarted = kernelFor(f);
            assert.deepEqual(await restarted.reconcile(f.manifest, async () => f.payload), {
              committed: 1,
              retryable: 0,
              waiting: 0,
            });
            assert.equal(
              (await restarted.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
              'already_applied',
            );
            assert.equal(
              (
                await db.query(
                  'SELECT count(*)::int n FROM platform.legacy_migration_events WHERE run_id=$1',
                  [f.manifest.runId],
                )
              ).rows[0].n,
              3,
            );
          } finally {
            await faulty.close();
            await finish(f);
          }
        },
      );

      await suite.test(
        'cross-run durable source receipts reuse committed chat without another cursor increment',
        async () => {
          const f = await scenario();
          try {
            await prepare(f);
            await f.apply();
            await f.kernel.reconcile(f.manifest, async () => f.payload);
            await f.kernel.close(f.manifest, async () => f.payload);
            const cursor = (
              await db.query('SELECT * FROM realtime.user_update_cursors WHERE user_id=$1', [
                f.user.id,
              ])
            ).rows[0];
            const later = buildExecutionManifest({
              ...strip(f.manifest),
              runId: randomUUID(),
              units: f.manifest.units.map(strip),
            });
            f.manifest = later;
            await f.proofs.configure(later);
            await prepare(f);
            assert.equal((await f.apply()).status, 'reused');
            assert.deepEqual(
              (
                await db.query('SELECT * FROM realtime.user_update_cursors WHERE user_id=$1', [
                  f.user.id,
                ])
              ).rows[0],
              cursor,
            );
          } finally {
            await finish(f);
          }
        },
      );

      await suite.test(
        'two conversations for the same owner retain monotone cursor invalidation and both reconcile',
        async () => {
          const a = await scenario(),
            b = await scenario();
          // Make a second genuine same-owner conversation/source; do not edit existing protected identities.
          const second = await addFixtureConversation(lab, { owner: a.user.id });
          b.data.rows.forEach((row) => {
            row.user_id = a.user.id;
          });
          b.data.bindings.forEach((row) =>
            Object.assign(row, {
              ownerUserId: a.user.id,
              legacyOwnerUserId: a.user.id,
              conversationId: second.id,
              userParticipantId: second.userParticipant,
              peerParticipantId: second.peerParticipant,
              systemParticipantId: second.system,
            }),
          );
          b.data.snapshotDigest = a.data.snapshotDigest;
          b.data.review.inventory.sourceDigest = a.data.snapshotDigest;
          await b.saveSource();
          const planned = await db.transaction((tx) =>
            a.handler.prepare(tx, { sourceKey: b.sourceKey }),
          );
          const manifest = buildExecutionManifest({
            ...strip(a.manifest),
            units: [
              strip(a.manifest.units[0]),
              { ...planned.unit, dependsOn: [a.manifest.units[0].key] },
            ],
          });
          a.manifest = manifest;
          await a.proofs.configure(manifest);
          try {
            await prepare(a);
            await a.apply();
            await a.kernel.executeUnit(manifest, manifest.units[1].key, planned.payload);
            const payloadFor = async (key) =>
              key === manifest.units[0].key ? a.payload : planned.payload;
            assert.deepEqual(await a.kernel.reconcile(manifest, payloadFor), {
              committed: 2,
              retryable: 0,
              waiting: 0,
            });
            const cursor = (
              await db.query(
                'SELECT last_update_seq,trimmed_through FROM realtime.user_update_cursors WHERE user_id=$1',
                [a.user.id],
              )
            ).rows[0];
            assert.deepEqual(cursor, { last_update_seq: '2', trimmed_through: '2' });
          } finally {
            await finish(a);
          }
        },
      );

      await suite.test(
        'post-commit content or deletion drift refuses recovery and release; no account resurrection',
        async () => {
          const f = await scenario();
          try {
            await prepare(f);
            await f.apply();
            await db.query(
              "UPDATE chat.messages SET status='recalled',content_ciphertext=NULL,recalled_at=$2 WHERE id=$1",
              [f.payload.plan.newMessages[0].id, cutoff],
            );
            await assert.rejects(f.kernel.reconcile(f.manifest, async () => f.payload));
            await assert.rejects(f.kernel.markReleased(f.manifest, async () => f.payload));
            assert.equal(
              (await f.baseline()).messages.find(
                (row) => row.id === f.payload.plan.newMessages[0].id,
              ).status,
              'recalled',
            );
            await db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [f.user.id]);
            await assert.rejects(f.apply(), matches('TARGET_ACCOUNT_NOT_ACTIVE'));
          } finally {
            await finish(f);
          }
        },
      );
    } finally {
      if (lab) {
        for (const f of cases) {
          try {
            const row = (
              await lab.database.query(
                'SELECT status FROM platform.legacy_migration_runs WHERE run_id=$1',
                [f.manifest.runId],
              )
            ).rows[0];
            if (row && ['prepared', 'executing', 'verified'].includes(row.status)) {
              await f.proofs.configure(f.manifest);
              await f.kernel.halt(f.manifest);
            }
          } catch {
            /* preserve incomplete state for review */
          }
        }
        await lab.close();
      }
    }
  },
);
