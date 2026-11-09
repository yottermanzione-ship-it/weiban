/** Local rehearsal producers. These observe actual fixture PG rows, not production processes. */
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import {
  executionDigest,
  executionJson,
  readExecutionDatabaseFacts,
} from './migration-execution-ledger.mjs';

export async function assertExecutionFixture(database) {
  const url = new URL(database?.pool?.options?.connectionString ?? 'invalid:');
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '56389' ||
    url.pathname !== '/codex_migration_execution_1109' ||
    url.username !== 'postgres' ||
    url.search ||
    url.hash
  )
    throw new Error('FIXED_EXECUTION_FIXTURE_REQUIRED');
  const result = await database.query(
    "SELECT current_database() name,synthetic FROM public.codex_migration_fixture WHERE id='migration-1109'",
  );
  if (
    result.rows.length !== 1 ||
    result.rows[0].name !== 'codex_migration_execution_1109' ||
    result.rows[0].synthetic !== true
  )
    throw new Error('EXECUTION_FIXTURE_MARKER_REQUIRED');
}
export async function initializeExecutionFixture(database) {
  await assertExecutionFixture(database);
  await database.query(`CREATE SCHEMA IF NOT EXISTS codex_execution_fixture;
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.counter(singleton boolean PRIMARY KEY CHECK(singleton),value bigint NOT NULL);
    INSERT INTO codex_execution_fixture.counter VALUES(true,0) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.business(id uuid PRIMARY KEY,owner_id uuid NOT NULL,value integer NOT NULL);
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.sources(id uuid PRIMARY KEY,owner_id uuid NOT NULL,source_value integer NOT NULL,version integer NOT NULL,snapshot_digest text NOT NULL);
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.controls(control_id uuid PRIMARY KEY,manifest jsonb NOT NULL,expired boolean NOT NULL DEFAULT false);
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.attestations(digest text PRIMARY KEY,envelope jsonb NOT NULL,public_key text NOT NULL,archived_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS codex_execution_fixture.writers(control_id uuid NOT NULL,id text NOT NULL,state text NOT NULL,generation integer NOT NULL,PRIMARY KEY(control_id,id));
    CREATE OR REPLACE FUNCTION codex_execution_fixture.count_business_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF coalesce(current_setting('weiban.legacy_migration_run',true),'')='' THEN
        UPDATE codex_execution_fixture.counter SET value=value+1 WHERE singleton=true;
      END IF;
      RETURN NULL;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='codex_execution_fixture_write_counter' AND tgrelid='codex_execution_fixture.business'::regclass) THEN
        CREATE TRIGGER codex_execution_fixture_write_counter AFTER INSERT OR UPDATE OR DELETE ON codex_execution_fixture.business FOR EACH ROW EXECUTE FUNCTION codex_execution_fixture.count_business_write();
      END IF;
    END $$;`);
}
/** Private signing keys stay in this process. A caller cannot change the signed mode to production. */
export async function createExecutionFixtureProbes(database) {
  await assertExecutionFixture(database);
  const controlId = randomUUID(),
    authorities = {},
    grants = new Map();
  for (const kind of ['identity', 'maintenance', 'authorization']) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const issuer = `fixture-pg-${kind}-v1`;
    authorities[kind] = { publicKey, privateKey, issuer };
  }
  async function control(reader) {
    const row = (
      await reader.query('SELECT * FROM codex_execution_fixture.controls WHERE control_id=$1', [
        controlId,
      ])
    ).rows[0];
    if (!row) throw new Error('FIXTURE_PROBE_NOT_CONFIGURED');
    return row;
  }
  const provider = (kind) =>
    Object.freeze({
      kind,
      mode: 'rehearsal',
      issuer: authorities[kind].issuer,
      publicKey: authorities[kind].publicKey,
      async collect(challenge, { tx } = {}) {
        const reader = tx ?? database,
          row = await control(reader),
          manifest = row.manifest;
        const now = Date.now(),
          issued = row.expired ? now - 120_000 : now;
        let observation;
        if (kind === 'identity') {
          const facts = await readExecutionDatabaseFacts(reader);
          const count = (
            await reader.query(
              'SELECT value FROM codex_execution_fixture.counter WHERE singleton=true',
            )
          ).rows[0];
          observation = {
            targetDigest: facts.targetDigest,
            schemaDigest: facts.schemaDigest,
            codeSha: manifest.codeSha,
            businessWriteCounter: Number(count.value),
          };
        } else if (kind === 'maintenance') {
          const writers = (
            await reader.query(
              'SELECT id,state,generation FROM codex_execution_fixture.writers WHERE control_id=$1 ORDER BY id',
              [controlId],
            )
          ).rows;
          observation = {
            inventoryDigest: manifest.inventoryDigest,
            requiredDomains: manifest.requiredDomains,
            sourceDigest: manifest.sourceDigest,
            writers: writers.map((writer) => ({
              ...writer,
              processDigest: executionDigest({
                controlId,
                id: writer.id,
                generation: writer.generation,
              }),
            })),
            inFlight: { calls: 0, generations: 0, jobs: 0, channels: 0, paymentTransactions: 0 },
            fence: {
              runId: manifest.runId,
              manifestDigest: manifest.digest,
              epoch: executionDigest({ controlId, writers }),
              expiresAt: new Date(issued + 20_000).toISOString(),
            },
            checkpointDigest: executionDigest({ controlId, source: manifest.sourceDigest }),
            receiptJournalIdDigest: manifest.receiptJournalIdDigest,
            receiptJournalDigest: executionDigest({
              controlId,
              journal: manifest.receiptJournalIdDigest,
            }),
            backupSetDigest: manifest.backupSetDigest,
          };
        } else {
          const grant = grants.get(challenge.manifestDigest);
          if (!grant || !grant.operations.includes(challenge.operation))
            throw new Error('FIXTURE_EXECUTION_PERMISSION_MISSING');
          const unit = manifest.units.find((value) => value.key === challenge.unitKey);
          observation = {
            grantId: grant.id,
            operation: challenge.operation,
            approverDigest: executionDigest('synthetic-operator'),
            policyDigest: manifest.policyDigest,
            approvedDigest: unit?.digest ?? manifest.digest,
          };
        }
        const payload = {
          kind,
          mode: 'rehearsal',
          issuer: authorities[kind].issuer,
          challenge,
          issuedAt: new Date(issued).toISOString(),
          expiresAt: new Date(issued + 20_000).toISOString(),
          observation,
        };
        const envelope = {
          payload,
          signature: sign(
            null,
            Buffer.from(executionJson(payload)),
            authorities[kind].privateKey,
          ).toString('base64url'),
        };
        await reader.query(
          'INSERT INTO codex_execution_fixture.attestations(digest,envelope,public_key) VALUES($1,$2::jsonb,$3) ON CONFLICT DO NOTHING',
          [
            executionDigest(envelope),
            JSON.stringify(envelope),
            authorities[kind].publicKey.export({ type: 'spki', format: 'pem' }),
          ],
        );
        return envelope;
      },
      async readArchivedEvidence(digest, { tx } = {}) {
        return (
          (
            await (tx ?? database).query(
              'SELECT envelope FROM codex_execution_fixture.attestations WHERE digest=$1',
              [digest],
            )
          ).rows[0]?.envelope ?? null
        );
      },
    });
  const identity = provider('identity'),
    maintenance = provider('maintenance'),
    authorization = provider('authorization');
  return {
    controlId,
    probes: { identity, maintenance },
    authorizationVerifier: authorization,
    async configure(
      manifest,
      operations = ['prepare', 'execute', 'reconcile', 'close', 'release', 'halt', 'restore-check'],
    ) {
      grants.set(manifest.digest, { id: randomUUID(), operations });
      await database.query(
        `INSERT INTO codex_execution_fixture.controls(control_id,manifest) VALUES($1,$2::jsonb)
        ON CONFLICT(control_id) DO UPDATE SET manifest=EXCLUDED.manifest,expired=false`,
        [controlId, JSON.stringify(manifest)],
      );
      for (const id of manifest.writerIds)
        await database.query(
          `INSERT INTO codex_execution_fixture.writers(control_id,id,state,generation) VALUES($1,$2,'stopped',1)
        ON CONFLICT(control_id,id) DO UPDATE SET state='stopped',generation=codex_execution_fixture.writers.generation+1`,
          [controlId, id],
        );
    },
    async expire(value = true) {
      await database.query(
        'UPDATE codex_execution_fixture.controls SET expired=$2 WHERE control_id=$1',
        [controlId, value],
      );
    },
    async setWriter(id, state) {
      await database.query(
        'UPDATE codex_execution_fixture.writers SET state=$3,generation=generation+1 WHERE control_id=$1 AND id=$2',
        [controlId, id, state],
      );
    },
  };
}
export const fixtureHandlerDigest = executionDigest({
  domain: 'fixture-values',
  implementation: 'same-tx-value-update-v1',
});
export function fixtureUnitFacts(payload) {
  return {
    scopeDigest: executionDigest({ id: payload.id, sourceId: payload.sourceId }),
    planDigest: executionDigest(payload),
    sourceDigest: payload.sourceDigest,
  };
}
export const fixtureSourceEvent = (source) => ({
  key: executionDigest({ table: 'fixture-source', id: source.id, version: source.version }),
  digest: executionDigest({
    id: source.id,
    ownerId: source.owner_id,
    value: source.source_value,
    version: source.version,
  }),
});
export function createExecutionFixtureHandler({ beforeApply, afterWrite } = {}) {
  const inspect = async (tx, payload) => {
    const row = (
      await tx.query(
        'SELECT id,owner_id,value FROM codex_execution_fixture.business WHERE id=$1 FOR UPDATE',
        [payload.id],
      )
    ).rows[0];
    if (!row) throw new Error('FIXTURE_TARGET_MISSING');
    const source = (
      await tx.query('SELECT * FROM codex_execution_fixture.sources WHERE id=$1', [
        payload.sourceId,
      ])
    ).rows[0];
    if (!source) throw new Error('FIXTURE_SOURCE_MISSING');
    return {
      ...fixtureUnitFacts(payload),
      sourceDigest: source.snapshot_digest,
      events: [fixtureSourceEvent(source)],
      sourceOwnerIds: [source.owner_id],
      targetOwnerIds: [row.owner_id],
      stateDigest: executionDigest(row),
    };
  };
  return Object.freeze({
    mode: 'rehearsal',
    domain: 'fixture-values',
    digest: fixtureHandlerDigest,
    metrics: ['updated'],
    inspect,
    inspectAfter: inspect,
    async apply(tx, payload) {
      await beforeApply?.(tx, payload);
      const source = (
        await tx.query('SELECT source_value FROM codex_execution_fixture.sources WHERE id=$1', [
          payload.sourceId,
        ])
      ).rows[0];
      const result = await tx.query(
        'UPDATE codex_execution_fixture.business SET value=$2 WHERE id=$1',
        [payload.id, source.source_value],
      );
      await afterWrite?.(tx, payload);
      return { updated: result.rowCount };
    },
  });
}
