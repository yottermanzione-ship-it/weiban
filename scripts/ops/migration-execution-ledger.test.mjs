/** Real PG ledger tests. Retains this task's database and every receipt; never resets shared databases. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { Migrator } from '../../apps/server/src/platform/db/migrator.ts';
import {
  assertExecutionTransaction,
  buildExecutionManifest,
  createMigrationExecutionKernel,
  executionDigest as hash,
  executionPolicyDigest,
  readExecutionDatabaseFacts,
} from './migration-execution-ledger.mjs';
import {
  assertExecutionFixture,
  createExecutionFixtureHandler,
  createExecutionFixtureProbes,
  fixtureHandlerDigest,
  fixtureSourceEvent,
  fixtureUnitFacts,
  initializeExecutionFixture,
} from './migration-execution-ledger-fixture.mjs';
import { legacyMigrationOwnerDigest } from './legacy-migration-preservation.mjs';

const url = 'postgres://postgres@127.0.0.1:56389/codex_migration_execution_1109';
const codeSha = 'a'.repeat(40),
  writers = [
    'legacy-api',
    'new-api',
    'legacy-admin',
    'new-admin',
    'legacy-workers',
    'new-workers',
    'legacy-channels',
    'new-channels',
  ];
const migrations = fileURLToPath(new URL('../../apps/server/drizzle', import.meta.url));
const down = readFileSync(
  new URL('../../apps/server/drizzle/0168_legacy_migration_runs.down.sql', import.meta.url),
  'utf8',
);
const strip = ({ digest: _digest, ...value }) => value;
const replan = (manifest, patch = {}) =>
  buildExecutionManifest({ ...strip(manifest), units: manifest.units.map(strip), ...patch });
const wait = () => {
  let done;
  const promise = new Promise((resolve) => {
    done = resolve;
  });
  return { promise, done };
};
const matches = (code) => (error) => error?.code === code || error?.message === code;

test(
  'migration execution ledger: retained, dedicated PostgreSQL rehearsal',
  { timeout: 240_000 },
  async (suite) => {
    const db = new Database({ url, onError: () => {} });
    const cases = [];
    try {
      await assertExecutionFixture(db);
      await new Migrator(url, migrations).up();
      await initializeExecutionFixture(db);
      const facts = await readExecutionDatabaseFacts(db),
        target = { connectionString: url, digest: facts.targetDigest };
      const kernel = (proofs, handler, options = {}, database = db) =>
        createMigrationExecutionKernel({
          database,
          target,
          mode: 'rehearsal',
          probes: proofs.probes,
          authorizationVerifier: proofs.authorizationVerifier,
          handlers: [handler],
          options,
        });
      async function scenario({
        handler = createExecutionFixtureHandler(),
        sourceOwner = randomUUID(),
        targetOwner = sourceOwner,
        options = {},
        privatePayload = 'SYNTHETIC_PRIVATE_PAYLOAD_NEVER_IN_LEDGER',
      } = {}) {
        const sourceDigest = hash(randomUUID()),
          id = randomUUID(),
          sourceId = randomUUID(),
          source = {
            id: sourceId,
            owner_id: sourceOwner,
            source_value: 17,
            version: 1,
            snapshot_digest: sourceDigest,
          };
        await db.query(
          'INSERT INTO codex_execution_fixture.business(id,owner_id,value) VALUES($1,$2,5)',
          [id, targetOwner],
        );
        await db.query(
          'INSERT INTO codex_execution_fixture.sources(id,owner_id,source_value,version,snapshot_digest) VALUES($1,$2,$3,$4,$5)',
          [source.id, source.owner_id, source.source_value, source.version, source.snapshot_digest],
        );
        const payload = { id, sourceId, sourceDigest, privatePayload },
          unitFacts = fixtureUnitFacts(payload);
        const unit = {
          key: hash({ id, sourceId }),
          domain: 'fixture-values',
          handlerDigest: fixtureHandlerDigest,
          planDigest: unitFacts.planDigest,
          scopeDigest: unitFacts.scopeDigest,
          beforeDigest: hash({ id, owner_id: targetOwner, value: 5 }),
          afterDigest: hash({ id, owner_id: targetOwner, value: 17 }),
          sourceOwnerDigests: [legacyMigrationOwnerDigest(sourceOwner)],
          targetOwnerDigests: [legacyMigrationOwnerDigest(targetOwner)],
          events: [fixtureSourceEvent(source)],
          dependsOn: [],
        };
        const manifest = buildExecutionManifest({
          runId: randomUUID(),
          targetDigest: target.digest,
          sourceDigest,
          schemaDigest: facts.schemaDigest,
          policyDigest: executionPolicyDigest(options),
          codeSha,
          inventoryDigest: hash({ writers, domains: ['fixture-values'] }),
          backupSetDigest: hash(`fixture-backup:${sourceDigest}`),
          receiptJournalIdDigest: hash(`fixture-receipts:${sourceDigest}`),
          requiredDomains: ['fixture-values'],
          writerIds: writers,
          units: [unit],
        });
        const proofs = await createExecutionFixtureProbes(db);
        await proofs.configure(manifest);
        const context = {
          payload,
          manifest,
          proofs,
          handler,
          options,
          kernel: kernel(proofs, handler, options),
          source,
          targetOwner,
          payloadFor: async () => payload,
          value: async () =>
            (await db.query('SELECT value FROM codex_execution_fixture.business WHERE id=$1', [id]))
              .rows[0].value,
          eventCount: async () =>
            Number(
              (
                await db.query(
                  'SELECT count(*) n FROM platform.legacy_migration_events WHERE event_key=$1',
                  [unit.events[0].key],
                )
              ).rows[0].n,
            ),
        };
        cases.push(context);
        return context;
      }
      async function end(f) {
        const row = (
          await db.query('SELECT status FROM platform.legacy_migration_runs WHERE run_id=$1', [
            f.manifest.runId,
          ])
        ).rows[0];
        if (row && ['prepared', 'executing', 'verified'].includes(row.status)) {
          await f.proofs.configure(f.manifest);
          await kernel(f.proofs, createExecutionFixtureHandler(), f.options).halt(f.manifest);
        }
      }
      await suite.test(
        'default CLI and default kernel do not execute or discover connections',
        async () => {
          const result = spawnSync(
            process.execPath,
            ['scripts/ops/migration-execution-ledger.mjs'],
            { encoding: 'utf8' },
          );
          assert.equal(result.status, 0);
          assert.equal(JSON.parse(result.stdout).mode, 'plan');
          const denied = spawnSync(
            process.execPath,
            ['scripts/ops/migration-execution-ledger.mjs', '--execute'],
            { encoding: 'utf8' },
          );
          assert.notEqual(denied.status, 0);
          await assert.rejects(
            createMigrationExecutionKernel().prepare({}),
            matches('EXECUTION_DISABLED'),
          );
          assert.throws(
            () => createMigrationExecutionKernel({ maxEvidenceAgeMs: Infinity }),
            matches('EVIDENCE_AGE_BOUND_INVALID'),
          );
          assert.throws(
            () => createMigrationExecutionKernel({ mode: 'production', now: () => 0 }),
            matches('PRODUCTION_CLOCK_OVERRIDE_FORBIDDEN'),
          );
        },
      );
      await suite.test(
        'business write, source receipt and unit receipt commit together; retry does not write twice',
        async () => {
          let applied = 0;
          const f = await scenario({
            handler: createExecutionFixtureHandler({
              afterWrite: () => {
                applied++;
              },
            }),
          });
          try {
            assert.equal((await f.kernel.prepare(f.manifest)).status, 'prepared');
            assert.equal(
              (await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
              'applied',
            );
            assert.equal(await f.value(), 17);
            assert.equal(await f.eventCount(), 1);
            assert.equal(
              (await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
              'already_applied',
            );
            assert.equal(applied, 1);
            const records = await db.query(
              `SELECT manifest::text body FROM platform.legacy_migration_runs WHERE run_id=$1
          UNION ALL SELECT result_counts::text FROM platform.legacy_migration_units WHERE run_id=$1
          UNION ALL SELECT issuer_key_digests::text FROM platform.legacy_migration_evidence WHERE run_id=$1`,
              [f.manifest.runId],
            );
            assert.ok(
              records.rows.every(
                (row) =>
                  !row.body.includes(f.payload.privatePayload) &&
                  !row.body.includes(f.source.owner_id),
              ),
            );
            assert.deepEqual(await f.kernel.reconcile(f.manifest, f.payloadFor), {
              committed: 1,
              retryable: 0,
              waiting: 0,
            });
            assert.equal((await f.kernel.close(f.manifest, f.payloadFor)).status, 'closed');
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'transaction capability cannot be forged, used during inspect, reused or kept after rollback',
        async () => {
          assert.throws(
            () => assertExecutionTransaction({}),
            matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
          );
          await db.transaction(async (tx) =>
            assert.throws(
              () => assertExecutionTransaction(tx),
              matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
            ),
          );
          let captured;
          const base = createExecutionFixtureHandler({
            beforeApply: (tx) => {
              captured = tx;
              assert.equal(
                assertExecutionTransaction(tx, { domain: 'fixture-values' }).domain,
                'fixture-values',
              );
              assert.throws(
                () => assertExecutionTransaction(tx, { domain: 'wrong-domain' }),
                matches('EXECUTION_TRANSACTION_SCOPE_MISMATCH'),
              );
              assert.ok(Object.isFrozen(assertExecutionTransaction(tx)));
            },
          });
          const handler = {
            ...base,
            inspect: async (tx, payload) => {
              assert.throws(
                () => assertExecutionTransaction(tx),
                matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
              );
              return base.inspect(tx, payload);
            },
          };
          const f = await scenario({ handler });
          try {
            await f.kernel.prepare(f.manifest);
            await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
            assert.throws(
              () => assertExecutionTransaction(captured),
              matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
            );
          } finally {
            await end(f);
          }
          let failedTx;
          const broken = await scenario({
            handler: createExecutionFixtureHandler({
              afterWrite: (tx) => {
                failedTx = tx;
                throw new Error('synthetic-private-error-must-not-be-recorded');
              },
            }),
          });
          try {
            await broken.kernel.prepare(broken.manifest);
            await assert.rejects(
              broken.kernel.executeUnit(
                broken.manifest,
                broken.manifest.units[0].key,
                broken.payload,
              ),
              matches('ADAPTER_OR_CONNECTION_FAILURE'),
            );
            assert.throws(
              () => assertExecutionTransaction(failedTx),
              matches('EXECUTION_TRANSACTION_CAPABILITY_REQUIRED'),
            );
          } finally {
            await end(broken);
          }
        },
      );
      await suite.test('source events are deduplicated across distinct closed runs', async () => {
        let applied = 0;
        const f = await scenario({
          handler: createExecutionFixtureHandler({
            afterWrite: () => {
              applied++;
            },
          }),
        });
        try {
          await f.kernel.prepare(f.manifest);
          await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
          await f.kernel.reconcile(f.manifest, f.payloadFor);
          await f.kernel.close(f.manifest, f.payloadFor);
          f.manifest = replan(f.manifest, {
            runId: randomUUID(),
            units: f.manifest.units.map((unit) => ({
              ...strip(unit),
              beforeDigest: unit.afterDigest,
            })),
          });
          await f.proofs.configure(f.manifest);
          await f.kernel.prepare(f.manifest);
          assert.equal(
            (await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
            'reused',
          );
          assert.equal(applied, 1);
          assert.equal(await f.eventCount(), 1);
          assert.equal(await f.value(), 17);
        } finally {
          await end(f);
        }
      });
      await suite.test(
        'concurrent execution fails fast while the first PG transaction owns the target lock',
        async () => {
          const entered = wait(),
            release = wait();
          let applied = 0;
          const f = await scenario({
            handler: createExecutionFixtureHandler({
              beforeApply: async () => {
                entered.done();
                await release.promise;
                applied++;
              },
            }),
          });
          try {
            await f.kernel.prepare(f.manifest);
            const first = f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
            await entered.promise;
            try {
              await assert.rejects(
                f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
                matches('EXECUTION_BUSY'),
              );
            } finally {
              release.done();
            }
            await first;
            assert.equal(applied, 1);
            assert.equal(await f.eventCount(), 1);
          } finally {
            release.done();
            await end(f);
          }
        },
      );
      await suite.test(
        'wrong target, changed manifest and a missing required handler refuse before business writes',
        async () => {
          const f = await scenario();
          let reads = 0;
          const watched = {
            pool: db.pool,
            query: (...args) => {
              reads++;
              return db.query(...args);
            },
            transaction: db.transaction.bind(db),
          };
          const wrong = createMigrationExecutionKernel({
            database: watched,
            target: { ...target, connectionString: url + '?invalid=1' },
            mode: 'rehearsal',
            probes: f.proofs.probes,
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [f.handler],
          });
          await assert.rejects(wrong.prepare(f.manifest), matches('DATABASE_CONNECTION_MISMATCH'));
          assert.equal(reads, 0);
          const wrongTarget = replan(f.manifest, { targetDigest: hash('different-installation') });
          const pin = createMigrationExecutionKernel({
            database: db,
            target: { ...target, digest: wrongTarget.targetDigest },
            mode: 'rehearsal',
            probes: f.proofs.probes,
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [f.handler],
          });
          await assert.rejects(pin.prepare(wrongTarget), matches('TARGET_IDENTITY_MISMATCH'));
          await assert.rejects(
            f.kernel.prepare({ ...f.manifest, codeSha: 'b'.repeat(40) }),
            matches('MANIFEST_CHANGED'),
          );
          const missing = replan(f.manifest, {
            requiredDomains: ['fixture-values', 'unwired-domain'],
          });
          await assert.rejects(f.kernel.prepare(missing), matches('HANDLER_NOT_REGISTERED'));
          assert.equal(await f.value(), 5);
        },
      );
      await suite.test(
        'production cannot borrow rehearsal producers or proceed with missing adapters',
        async () => {
          const f = await scenario();
          assert.throws(
            () => createMigrationExecutionKernel({ database: db, target, mode: 'production' }),
            matches('PRODUCTION_ADAPTER_NOT_REGISTERED'),
          );
          assert.throws(
            () =>
              createMigrationExecutionKernel({
                database: db,
                target,
                mode: 'production',
                probes: f.proofs.probes,
                authorizationVerifier: f.proofs.authorizationVerifier,
                handlers: [f.handler],
              }),
            matches('PRODUCTION_ADAPTER_NOT_REGISTERED'),
          );
          assert.equal(await f.value(), 5);
        },
      );
      await suite.test(
        'plain booleans, tampered signatures, stale evidence and replayed nonce cannot authorize writes',
        async () => {
          const f = await scenario();
          const tampered = {
            ...f.proofs.probes.maintenance,
            collect: async (...args) => {
              const value = await f.proofs.probes.maintenance.collect(...args);
              value.payload.observation.writers[0].generation++;
              return value;
            },
          };
          const bad = createMigrationExecutionKernel({
            database: db,
            target,
            mode: 'rehearsal',
            probes: { ...f.proofs.probes, maintenance: tampered },
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [f.handler],
          });
          await assert.rejects(bad.prepare(f.manifest), matches('EVIDENCE_SIGNATURE_INVALID'));
          await f.proofs.expire();
          await assert.rejects(f.kernel.prepare(f.manifest), matches('EVIDENCE_EXPIRED_OR_FUTURE'));
          await f.proofs.expire(false);
          let saved;
          const replay = {
            ...f.proofs.probes.maintenance,
            collect: async (...args) =>
              (saved ??= await f.proofs.probes.maintenance.collect(...args)),
          };
          const replayKernel = createMigrationExecutionKernel({
            database: db,
            target,
            mode: 'rehearsal',
            probes: { ...f.proofs.probes, maintenance: replay },
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [f.handler],
          });
          try {
            await replayKernel.prepare(f.manifest);
            await assert.rejects(
              replayKernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('EVIDENCE_CHALLENGE_MISMATCH'),
            );
            await assert.rejects(
              f.kernel.prepare({ ...f.manifest, writersStopped: true }),
              matches('MANIFEST_FIELDS_INVALID'),
            );
            assert.equal(await f.value(), 5);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'an absent execution grant is denied even with genuine maintenance evidence',
        async () => {
          const f = await scenario();
          await f.proofs.configure(f.manifest, ['halt']);
          await assert.rejects(f.kernel.prepare(f.manifest), matches('EXECUTION_NOT_AUTHORIZED'));
          assert.equal(await f.value(), 5);
        },
      );
      await suite.test(
        'signed evidence must be durably archived and read back with the same digest',
        async () => {
          const f = await scenario();
          const unavailable = {
            ...f.proofs.probes.maintenance,
            readArchivedEvidence: async () => null,
          };
          const bad = createMigrationExecutionKernel({
            database: db,
            target,
            mode: 'rehearsal',
            probes: { ...f.proofs.probes, maintenance: unavailable },
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [f.handler],
          });
          await assert.rejects(bad.prepare(f.manifest), matches('EVIDENCE_ARCHIVE_MISMATCH'));
          assert.equal(await f.value(), 5);
          await f.kernel.prepare(f.manifest);
          try {
            const row = (
              await db.query(
                'SELECT identity_digest,maintenance_digest,authorization_digest FROM platform.legacy_migration_evidence WHERE run_id=$1 LIMIT 1',
                [f.manifest.runId],
              )
            ).rows[0];
            const archived = await db.query(
              'SELECT digest,envelope,public_key FROM codex_execution_fixture.attestations WHERE digest=ANY($1::text[])',
              [Object.values(row)],
            );
            assert.equal(archived.rows.length, 3);
            for (const item of archived.rows) {
              assert.equal(hash(item.envelope), item.digest);
              assert.ok(item.public_key.startsWith('-----BEGIN PUBLIC KEY-----'));
              assert.ok(!JSON.stringify(item.envelope).includes(f.payload.privatePayload));
            }
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'committed dependencies survive interruption; only the remaining unit resumes',
        async () => {
          const f = await scenario(),
            id = randomUUID(),
            sourceId = randomUUID();
          const source = {
            id: sourceId,
            owner_id: f.source.owner_id,
            source_value: 31,
            version: 1,
            snapshot_digest: f.manifest.sourceDigest,
          };
          await db.query(
            'INSERT INTO codex_execution_fixture.business(id,owner_id,value) VALUES($1,$2,8)',
            [id, f.targetOwner],
          );
          await db.query(
            'INSERT INTO codex_execution_fixture.sources(id,owner_id,source_value,version,snapshot_digest) VALUES($1,$2,$3,$4,$5)',
            [
              source.id,
              source.owner_id,
              source.source_value,
              source.version,
              source.snapshot_digest,
            ],
          );
          const payload = { id, sourceId, sourceDigest: f.manifest.sourceDigest },
            facts = fixtureUnitFacts(payload);
          const unit = {
            key: hash(id),
            domain: 'fixture-values',
            handlerDigest: fixtureHandlerDigest,
            planDigest: facts.planDigest,
            scopeDigest: facts.scopeDigest,
            beforeDigest: hash({ id, owner_id: f.targetOwner, value: 8 }),
            afterDigest: hash({ id, owner_id: f.targetOwner, value: 31 }),
            sourceOwnerDigests: [legacyMigrationOwnerDigest(f.source.owner_id)],
            targetOwnerDigests: [legacyMigrationOwnerDigest(f.targetOwner)],
            events: [fixtureSourceEvent(source)],
            dependsOn: [f.manifest.units[0].key],
          };
          f.manifest = replan(f.manifest, { units: [...f.manifest.units.map(strip), unit] });
          await f.proofs.configure(f.manifest);
          const payloadFor = async (key) => (key === unit.key ? payload : f.payload);
          try {
            await f.kernel.prepare(f.manifest);
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, unit.key, payload),
              matches('DEPENDENCY_NOT_COMMITTED'),
            );
            await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
            const resumed = kernel(f.proofs, f.handler);
            assert.deepEqual(await resumed.reconcile(f.manifest, payloadFor), {
              committed: 1,
              retryable: 1,
              waiting: 0,
            });
            await resumed.executeUnit(f.manifest, unit.key, payload);
            assert.deepEqual(await resumed.reconcile(f.manifest, payloadFor), {
              committed: 2,
              retryable: 0,
              waiting: 0,
            });
            assert.equal(
              (
                await db.query('SELECT value FROM codex_execution_fixture.business WHERE id=$1', [
                  id,
                ])
              ).rows[0].value,
              31,
            );
            assert.equal(await f.eventCount(), 1);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'callback failure rolls back business and receipts; a new kernel resumes the pending unit',
        async () => {
          const f = await scenario({
            handler: createExecutionFixtureHandler({
              afterWrite: () => {
                throw new Error('synthetic-business-error');
              },
            }),
          });
          try {
            await f.kernel.prepare(f.manifest);
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('ADAPTER_OR_CONNECTION_FAILURE'),
            );
            assert.equal(await f.value(), 5);
            assert.equal(await f.eventCount(), 0);
            const fresh = kernel(f.proofs, createExecutionFixtureHandler());
            assert.deepEqual(await fresh.reconcile(f.manifest, f.payloadFor), {
              committed: 0,
              retryable: 1,
              waiting: 0,
            });
            assert.equal(
              (await fresh.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
              'applied',
            );
            assert.equal(await f.eventCount(), 1);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test('a changed expected result rolls the real transaction back', async () => {
        const f = await scenario();
        f.manifest = replan(f.manifest, {
          units: f.manifest.units.map((unit) => ({
            ...strip(unit),
            afterDigest: hash('wrong-after'),
          })),
        });
        await f.proofs.configure(f.manifest);
        try {
          await f.kernel.prepare(f.manifest);
          await assert.rejects(
            f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
            matches('POSTCONDITION_MISMATCH'),
          );
          assert.equal(await f.value(), 5);
          assert.equal(await f.eventCount(), 0);
        } finally {
          await end(f);
        }
      });
      await suite.test(
        'writer revival after callback is observed and rolls its business write back',
        async () => {
          let f;
          const handler = createExecutionFixtureHandler({
            afterWrite: async () => f.proofs.setWriter('new-workers', 'running'),
          });
          f = await scenario({ handler });
          try {
            await f.kernel.prepare(f.manifest);
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('WRITER_NOT_FENCED'),
            );
            assert.equal(await f.value(), 5);
            assert.equal(await f.eventCount(), 0);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'actual source and destination owners defeat re-signed false owner manifests',
        async () => {
          for (const side of ['source', 'target']) {
            const allowed = randomUUID(),
              preserved = randomUUID();
            let applied = 0;
            const f = await scenario({
              sourceOwner: side === 'source' ? preserved : allowed,
              targetOwner: side === 'target' ? preserved : allowed,
              options: { additionalPreservedOwnerDigests: [legacyMigrationOwnerDigest(preserved)] },
              handler: createExecutionFixtureHandler({
                afterWrite: () => {
                  applied++;
                },
              }),
            });
            f.manifest = replan(f.manifest, {
              units: f.manifest.units.map((unit) => ({
                ...strip(unit),
                sourceOwnerDigests: [legacyMigrationOwnerDigest(allowed)],
                targetOwnerDigests: [legacyMigrationOwnerDigest(allowed)],
              })),
            });
            await f.proofs.configure(f.manifest);
            try {
              await f.kernel.prepare(f.manifest);
              await assert.rejects(
                f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
                matches('LEGACY_MIGRATION_OWNER_PRESERVED'),
              );
              assert.equal(applied, 0);
              assert.equal(await f.value(), 5);
            } finally {
              await end(f);
            }
          }
        },
      );
      await suite.test(
        'source mutation without a new source event is rejected before apply',
        async () => {
          const f = await scenario();
          try {
            await f.kernel.prepare(f.manifest);
            await db.query(
              'UPDATE codex_execution_fixture.sources SET source_value=99 WHERE id=$1',
              [f.source.id],
            );
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('HANDLER_SOURCE_EVENTS_MISMATCH'),
            );
            assert.equal(await f.value(), 5);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'target drift after a committed receipt is rejected on retry, reconciliation and release',
        async () => {
          const f = await scenario();
          try {
            await f.kernel.prepare(f.manifest);
            await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
            await f.kernel.reconcile(f.manifest, f.payloadFor);
            await db.transaction(async (tx) => {
              await tx.query(
                "SELECT set_config('weiban.legacy_migration_run','fixture-unmanaged-writer',true)",
              );
              await tx.query('UPDATE codex_execution_fixture.business SET value=88 WHERE id=$1', [
                f.payload.id,
              ]);
            });
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('TARGET_CHANGED_AFTER_COMMIT'),
            );
            await assert.rejects(
              f.kernel.reconcile(f.manifest, f.payloadFor),
              matches('TARGET_CHANGED_AFTER_COMMIT'),
            );
            await assert.rejects(
              f.kernel.markReleased(f.manifest, f.payloadFor),
              matches('TARGET_CHANGED_AFTER_COMMIT'),
            );
            assert.equal(await f.value(), 88);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'new ordinary business writes block application, release and blind restore',
        async () => {
          const f = await scenario();
          try {
            await f.kernel.prepare(f.manifest);
            await db.query('UPDATE codex_execution_fixture.business SET value=66 WHERE id=$1', [
              f.payload.id,
            ]);
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('NEW_BUSINESS_WRITES_DETECTED'),
            );
            await assert.rejects(
              f.kernel.markReleased(f.manifest, f.payloadFor),
              matches('NEW_BUSINESS_WRITES_DETECTED'),
            );
            await assert.rejects(
              f.kernel.assertRestoreEligible(f.manifest),
              matches('NEW_BUSINESS_WRITES_DETECTED'),
            );
            assert.equal(await f.value(), 66);
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'COMMIT followed by termination of this test session recovers without a second business write',
        async () => {
          let applied = 0;
          const f = await scenario({
            handler: createExecutionFixtureHandler({
              afterWrite: () => {
                applied++;
              },
            }),
          });
          const faulty = new Database({ url, onError: () => {} });
          faulty.pool.options.application_name = 'codex-execution-ack-loss';
          let armed = true,
            terminated = false;
          faulty.pool.on('connect', (client) => {
            const query = client.query.bind(client);
            client.query = (...args) => {
              if (args[0] !== 'COMMIT' || !armed) return query(...args);
              return (async () => {
                const result = await query(...args);
                armed = false;
                const owned = await db.query(
                  'SELECT datname,application_name FROM pg_stat_activity WHERE pid=$1',
                  [client.processID],
                );
                assert.equal(owned.rows[0]?.datname, 'codex_migration_execution_1109');
                assert.equal(owned.rows[0]?.application_name, 'codex-execution-ack-loss');
                terminated = (
                  await db.query('SELECT pg_terminate_backend($1) killed', [client.processID])
                ).rows[0].killed;
                if (!terminated) return result;
                throw new Error('FIXTURE_COMMIT_ACK_LOST');
              })();
            };
          });
          try {
            await f.kernel.prepare(f.manifest);
            const interrupted = kernel(f.proofs, f.handler, {}, faulty);
            await assert.rejects(
              interrupted.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('ADAPTER_OR_CONNECTION_FAILURE'),
            );
            assert.equal(terminated, true);
            assert.equal(await f.value(), 17);
            assert.equal(await f.eventCount(), 1);
            const restarted = kernel(f.proofs, f.handler);
            assert.deepEqual(await restarted.reconcile(f.manifest, f.payloadFor), {
              committed: 1,
              retryable: 0,
              waiting: 0,
            });
            assert.equal(
              (await restarted.executeUnit(f.manifest, f.manifest.units[0].key, f.payload)).status,
              'already_applied',
            );
            assert.equal(applied, 1);
          } finally {
            await faulty.close();
            await end(f);
          }
        },
      );
      await suite.test(
        'restore is only an assessment; a release receipt irreversibly refuses blind restore',
        async () => {
          const f = await scenario();
          try {
            await f.kernel.prepare(f.manifest);
            await f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload);
            await f.kernel.reconcile(f.manifest, f.payloadFor);
            assert.deepEqual(await f.kernel.assertRestoreEligible(f.manifest), {
              eligible: true,
              executed: false,
              requiredAdapter: 'external-matching-baseline-restore-with-preserved-ledger',
            });
            assert.equal(await f.value(), 17);
            assert.deepEqual(await f.kernel.markReleased(f.manifest, f.payloadFor), {
              status: 'released',
              servicesChanged: false,
            });
            await assert.rejects(
              f.kernel.assertRestoreEligible(f.manifest),
              matches('BLIND_RESTORE_AFTER_RELEASE_FORBIDDEN'),
            );
            await assert.rejects(
              f.kernel.executeUnit(f.manifest, f.manifest.units[0].key, f.payload),
              matches('RUN_NOT_EXECUTABLE'),
            );
          } finally {
            await end(f);
          }
        },
      );
      await suite.test(
        'another active run blocks competing prepare and restoration of an older baseline',
        async () => {
          const f = await scenario();
          const original = f.manifest;
          try {
            await f.kernel.prepare(original);
            await f.kernel.executeUnit(original, original.units[0].key, f.payload);
            await f.kernel.reconcile(original, f.payloadFor);
            await f.kernel.close(original, f.payloadFor);
            const next = replan(original, {
              runId: randomUUID(),
              units: original.units.map((unit) => ({
                ...strip(unit),
                beforeDigest: unit.afterDigest,
              })),
            });
            f.manifest = next;
            await f.proofs.configure(next);
            await f.kernel.prepare(next);
            const competing = replan(next, { runId: randomUUID() });
            await f.proofs.configure(competing);
            await assert.rejects(f.kernel.prepare(competing), matches('ANOTHER_RUN_IS_ACTIVE'));
            await f.proofs.configure(original);
            await assert.rejects(
              f.kernel.assertRestoreEligible(original),
              matches('OTHER_ACTIVE_RUN_BLOCKS_RESTORE'),
            );
          } finally {
            await end(f);
          }
        },
      );
      await suite.test('a populated formal ledger refuses destructive migration down', async () => {
        await assert.rejects(
          db.transaction((tx) => tx.query(down)),
          /legacy_migration_ledger_requires_forward_fix/u,
        );
        assert.ok(
          Number(
            (await db.query('SELECT count(*) n FROM platform.legacy_migration_runs')).rows[0].n,
          ) > 0,
        );
      });
    } finally {
      // Keep all fixtures, business rows, source events and audit receipts for review.
      for (const f of cases) {
        const row = (
          await db.query('SELECT status FROM platform.legacy_migration_runs WHERE run_id=$1', [
            f.manifest.runId,
          ])
        ).rows[0];
        if (row && ['prepared', 'executing', 'verified'].includes(row.status)) {
          await f.proofs.configure(f.manifest);
          await createMigrationExecutionKernel({
            database: db,
            target: { connectionString: url, digest: f.manifest.targetDigest },
            mode: 'rehearsal',
            probes: f.proofs.probes,
            authorizationVerifier: f.proofs.authorizationVerifier,
            handlers: [createExecutionFixtureHandler()],
            options: f.options,
          }).halt(f.manifest);
        }
      }
      await db.close();
    }
  },
);
