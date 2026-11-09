/** Internal migration kernel. No connection discovery, service controls, HTTP listener or cutover CLI. */
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preservationPolicy from '../../apps/server/src/platform/migration-preservation-policy.json' with { type: 'json' };
import {
  assertLegacyMigrationOwnerAllowed,
  isLegacyMigrationOwnerDigestPreserved,
  legacyMigrationOwnerDigest,
} from './legacy-migration-preservation.mjs';

const HEX = /^[a-f0-9]{64}$/u,
  UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const NAME = /^[a-z][a-z0-9_-]{0,79}$/u;
const FLIGHTS = ['calls', 'generations', 'jobs', 'channels', 'paymentTransactions'];
export class MigrationExecutionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const need = (condition, code) => {
  if (!condition) throw new MigrationExecutionError(code);
};
const executionTransactions = new WeakMap();
/** Unforgeable in-process capability: valid only while this kernel awaits a verified handler.apply. */
export function assertExecutionTransaction(tx, expected = {}) {
  const context = executionTransactions.get(tx);
  need(context, 'EXECUTION_TRANSACTION_CAPABILITY_REQUIRED');
  need(
    record(expected) &&
      Object.entries(expected).every(
        ([key, value]) => Object.hasOwn(context, key) && context[key] === value,
      ),
    'EXECUTION_TRANSACTION_SCOPE_MISMATCH',
  );
  return context;
}
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) =>
  record(value) && Object.keys(value).every((key) => keys.includes(key));
const sorted = (items) => [...new Set(items)].sort();
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const executionJson = (value) => JSON.stringify(canonical(value));
export const executionDigest = (value) =>
  createHash('sha256').update(executionJson(value)).digest('hex');
export function executionPolicyDigest(options = {}) {
  const additional = options.additionalPreservedOwnerDigests ?? [];
  need(
    Array.isArray(additional) && additional.every((value) => HEX.test(value)),
    'PRESERVATION_POLICY_INVALID',
  );
  return executionDigest({ fixed: preservationPolicy, additional: sorted(additional) });
}
function eventsOf(value) {
  need(
    Array.isArray(value) && value.length > 0 && value.length <= 100_000,
    'SOURCE_EVENTS_REQUIRED',
  );
  const events = value
    .map((item) => {
      need(
        only(item, ['key', 'digest']) && HEX.test(item.key) && HEX.test(item.digest),
        'SOURCE_EVENT_INVALID',
      );
      return { key: item.key, digest: item.digest };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  need(new Set(events.map((event) => event.key)).size === events.length, 'SOURCE_EVENT_DUPLICATED');
  return events;
}
function ownerDigests(value) {
  need(
    Array.isArray(value) && value.length > 0 && value.every((item) => HEX.test(item)),
    'OWNER_DIGESTS_REQUIRED',
  );
  return sorted(value);
}
export function buildExecutionManifest(input) {
  need(
    only(input, [
      'runId',
      'targetDigest',
      'sourceDigest',
      'schemaDigest',
      'policyDigest',
      'codeSha',
      'inventoryDigest',
      'backupSetDigest',
      'receiptJournalIdDigest',
      'requiredDomains',
      'writerIds',
      'units',
    ]),
    'MANIFEST_FIELDS_INVALID',
  );
  need(UUID.test(input.runId) && /^[a-f0-9]{40}$/u.test(input.codeSha), 'RUN_IDENTITY_INVALID');
  for (const key of [
    'targetDigest',
    'sourceDigest',
    'schemaDigest',
    'policyDigest',
    'inventoryDigest',
    'backupSetDigest',
    'receiptJournalIdDigest',
  ])
    need(HEX.test(input[key]), 'MANIFEST_DIGEST_INVALID');
  need(
    Array.isArray(input.requiredDomains) &&
      input.requiredDomains.length > 0 &&
      input.requiredDomains.every((domain) => NAME.test(domain)),
    'DOMAIN_INVENTORY_REQUIRED',
  );
  need(
    Array.isArray(input.writerIds) &&
      input.writerIds.length > 0 &&
      input.writerIds.every((id) => NAME.test(id)),
    'WRITER_INVENTORY_REQUIRED',
  );
  need(
    Array.isArray(input.units) && input.units.length > 0 && input.units.length <= 10_000,
    'EXECUTION_UNITS_REQUIRED',
  );
  const units = input.units.map((item) => {
    need(
      only(item, [
        'key',
        'domain',
        'handlerDigest',
        'planDigest',
        'scopeDigest',
        'beforeDigest',
        'afterDigest',
        'sourceOwnerDigests',
        'targetOwnerDigests',
        'events',
        'dependsOn',
      ]),
      'UNIT_FIELDS_INVALID',
    );
    for (const key of [
      'key',
      'handlerDigest',
      'planDigest',
      'scopeDigest',
      'beforeDigest',
      'afterDigest',
    ])
      need(HEX.test(item[key]), 'UNIT_DIGEST_INVALID');
    need(NAME.test(item.domain), 'DOMAIN_INVALID');
    need(input.requiredDomains.includes(item.domain), 'DOMAIN_NOT_IN_INVENTORY');
    need(
      Array.isArray(item.dependsOn) && item.dependsOn.every((key) => HEX.test(key)),
      'UNIT_DEPENDENCIES_INVALID',
    );
    const unit = {
      ...item,
      sourceOwnerDigests: ownerDigests(item.sourceOwnerDigests),
      targetOwnerDigests: ownerDigests(item.targetOwnerDigests),
      events: eventsOf(item.events),
      dependsOn: sorted(item.dependsOn),
    };
    return { ...unit, digest: executionDigest(unit) };
  });
  const byKey = new Map(units.map((unit) => [unit.key, unit]));
  need(byKey.size === units.length, 'UNIT_DUPLICATED');
  const seen = new Set(),
    pending = new Set(),
    sourceEvents = new Set();
  const visit = (unit) => {
    need(!pending.has(unit.key), 'DEPENDENCY_CYCLE');
    if (seen.has(unit.key)) return;
    pending.add(unit.key);
    for (const key of unit.dependsOn) {
      need(byKey.has(key), 'DEPENDENCY_MISSING');
      visit(byKey.get(key));
    }
    pending.delete(unit.key);
    seen.add(unit.key);
  };
  for (const unit of units) {
    visit(unit);
    for (const event of unit.events) {
      const key = `${unit.domain}:${event.key}`;
      need(!sourceEvents.has(key), 'EVENT_SPLIT_ACROSS_UNITS');
      sourceEvents.add(key);
    }
  }
  const manifest = {
    ...input,
    requiredDomains: sorted(input.requiredDomains),
    writerIds: sorted(input.writerIds),
    units,
  };
  return { ...manifest, digest: executionDigest(manifest) };
}
function checkedManifest(input) {
  need(record(input) && HEX.test(input.digest), 'MANIFEST_INVALID');
  const { digest, units, ...header } = input;
  need(Array.isArray(units), 'EXECUTION_UNITS_REQUIRED');
  const rebuilt = buildExecutionManifest({
    ...header,
    units: units.map(({ digest: _digest, ...unit }) => unit),
  });
  need(
    digest === rebuilt.digest && executionDigest(input) === executionDigest(rebuilt),
    'MANIFEST_CHANGED',
  );
  return rebuilt;
}
export async function readExecutionDatabaseFacts(reader) {
  const result = await reader.query(`SELECT current_database() AS database_name,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
    installation_id::text FROM platform.legacy_migration_target_identity WHERE singleton=true`);
  need(
    result.rows.length === 1 && UUID.test(result.rows[0].installation_id),
    'TARGET_INSTALLATION_IDENTITY_MISSING',
  );
  const row = result.rows[0],
    identity = {
      installationId: row.installation_id,
      database: row.database_name,
      databaseOid: row.database_oid,
    };
  const migrations = (
    await reader.query('SELECT tag,checksum FROM public.schema_migrations ORDER BY tag')
  ).rows;
  const columns = (
    await reader.query(`SELECT n.nspname,c.relname,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_value
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema','codex_execution_fixture') AND n.nspname !~ '^pg_'
    ORDER BY n.nspname,c.relname,a.attnum`)
  ).rows;
  const constraints = (
    await reader.query(`SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','codex_execution_fixture') AND n.nspname !~ '^pg_' ORDER BY n.nspname,c.relname,k.conname`)
  ).rows;
  const indexes = (
    await reader.query(
      "SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema','codex_execution_fixture') AND schemaname !~ '^pg_' ORDER BY schemaname,tablename,indexname",
    )
  ).rows;
  return {
    identity,
    targetDigest: executionDigest(identity),
    schemaDigest: executionDigest({ migrations, columns, constraints, indexes }),
  };
}
function publicKey(provider) {
  const key =
    provider.publicKey?.type === 'public'
      ? provider.publicKey
      : createPublicKey(provider.publicKey);
  need(key.asymmetricKeyType === 'ed25519', 'ATTESTOR_KEY_INVALID');
  return key;
}
function validCounts(value, metrics) {
  need(
    record(value) && Object.keys(value).every((key) => metrics.includes(key)),
    'RESULT_COUNTS_INVALID',
  );
  need(
    Object.values(value).every((number) => Number.isSafeInteger(number) && number >= 0),
    'RESULT_COUNTS_INVALID',
  );
  return value;
}
/** Providers and handlers are trusted executable adapters, never deserialized from the manifest. */
export function createMigrationExecutionKernel({
  database,
  target,
  mode = 'plan',
  probes,
  authorizationVerifier,
  handlers = [],
  options = {},
  now = Date.now,
  maxEvidenceAgeMs = 30_000,
} = {}) {
  const executable = mode === 'rehearsal' || mode === 'production';
  need(mode === 'plan' || executable, 'EXECUTION_MODE_INVALID');
  need(
    Number.isSafeInteger(maxEvidenceAgeMs) && maxEvidenceAgeMs > 0 && maxEvidenceAgeMs <= 60_000,
    'EVIDENCE_AGE_BOUND_INVALID',
  );
  need(mode !== 'production' || now === Date.now, 'PRODUCTION_CLOCK_OVERRIDE_FORBIDDEN');
  const adapters = {
    identity: probes?.identity,
    maintenance: probes?.maintenance,
    authorization: authorizationVerifier,
  };
  const registry = new Map(handlers.map((handler) => [handler.domain, handler]));
  const policyDigest = executionPolicyDigest(options);
  if (executable) {
    need(
      database?.transaction &&
        database?.query &&
        target?.connectionString &&
        HEX.test(target.digest),
      'EXPLICIT_DATABASE_REQUIRED',
    );
    for (const [kind, adapter] of Object.entries(adapters)) {
      need(
        adapter &&
          adapter.mode === mode &&
          typeof adapter.collect === 'function' &&
          typeof adapter.readArchivedEvidence === 'function' &&
          NAME.test(adapter.issuer),
        mode === 'production'
          ? 'PRODUCTION_ADAPTER_NOT_REGISTERED'
          : 'PROBE_ADAPTER_NOT_REGISTERED',
      );
      need(adapter.kind === kind, 'PROBE_KIND_MISMATCH');
      publicKey(adapter);
    }
    for (const handler of handlers)
      need(
        handler.mode === mode &&
          NAME.test(handler.domain) &&
          HEX.test(handler.digest) &&
          ['inspect', 'apply', 'inspectAfter'].every((key) => typeof handler[key] === 'function') &&
          Array.isArray(handler.metrics) &&
          handler.metrics.every((key) => NAME.test(key)),
        'HANDLER_ADAPTER_INVALID',
      );
    need(registry.size === handlers.length, 'HANDLER_DUPLICATED');
  }
  async function connection(reader = database) {
    need(executable, 'EXECUTION_DISABLED');
    need(
      database.pool?.options?.connectionString === target.connectionString,
      'DATABASE_CONNECTION_MISMATCH',
    );
    if (mode === 'rehearsal') {
      let url;
      try {
        url = new URL(target.connectionString);
      } catch {
        throw new MigrationExecutionError('TARGET_URL_INVALID');
      }
      need(
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
          url.hostname === '127.0.0.1' &&
          /^\/codex_migration_execution_[a-z0-9_]+$/u.test(url.pathname) &&
          !url.search &&
          !url.hash,
        'DEDICATED_REHEARSAL_DATABASE_REQUIRED',
      );
      const marker = await reader.query(
        "SELECT synthetic FROM public.codex_migration_fixture WHERE id='migration-1109'",
      );
      need(
        marker.rows.length === 1 && marker.rows[0].synthetic === true,
        'REHEARSAL_MARKER_REQUIRED',
      );
    }
    const facts = await readExecutionDatabaseFacts(reader);
    need(facts.targetDigest === target.digest, 'TARGET_IDENTITY_MISMATCH');
    if (mode === 'production')
      need(
        !facts.identity.database.startsWith('codex_migration_') &&
          facts.identity.database !== 'weiban_test',
        'REHEARSAL_TARGET_IS_NOT_PRODUCTION',
      );
    return facts;
  }
  function validate(manifest) {
    const result = checkedManifest(manifest);
    need(
      result.targetDigest === target?.digest && result.policyDigest === policyDigest,
      'EXECUTION_BINDING_MISMATCH',
    );
    for (const domain of result.requiredDomains)
      need(registry.has(domain), 'HANDLER_NOT_REGISTERED');
    for (const unit of result.units) {
      const handler = registry.get(unit.domain);
      need(
        handler && handler.mode === mode && handler.digest === unit.handlerDigest,
        'HANDLER_NOT_REGISTERED',
      );
      for (const owner of [...unit.sourceOwnerDigests, ...unit.targetOwnerDigests])
        need(
          !isLegacyMigrationOwnerDigestPreserved(owner, options.additionalPreservedOwnerDigests),
          'LEGACY_MIGRATION_OWNER_PRESERVED',
        );
    }
    return result;
  }
  function fresh(payload) {
    need(
      typeof payload.issuedAt === 'string' && typeof payload.expiresAt === 'string',
      'EVIDENCE_TIME_INVALID',
    );
    const time = now(),
      issued = Date.parse(payload.issuedAt),
      expiry = Date.parse(payload.expiresAt);
    need(
      Number.isFinite(issued) &&
        Number.isFinite(expiry) &&
        issued <= time + 1000 &&
        time - issued <= maxEvidenceAgeMs &&
        expiry > time &&
        expiry > issued &&
        expiry - issued <= maxEvidenceAgeMs,
      'EVIDENCE_EXPIRED_OR_FUTURE',
    );
  }
  async function gate(manifest, operation, unit, tx) {
    const facts = await connection(tx ?? database);
    need(facts.schemaDigest === manifest.schemaDigest, 'SCHEMA_CHANGED');
    const challenge = {
      protocol: 'legacy-migration-evidence-v1',
      nonce: randomUUID(),
      runId: manifest.runId,
      manifestDigest: manifest.digest,
      targetDigest: manifest.targetDigest,
      sourceDigest: manifest.sourceDigest,
      scopeDigest: unit?.scopeDigest ?? manifest.digest,
      operation,
      unitKey: unit?.key ?? null,
    };
    const envelopes = {};
    for (const [kind, adapter] of Object.entries(adapters)) {
      let envelope;
      try {
        envelope = await adapter.collect(challenge, { tx });
      } catch {
        throw new MigrationExecutionError(
          kind === 'authorization' ? 'EXECUTION_NOT_AUTHORIZED' : 'PROBE_OBSERVATION_FAILED',
        );
      }
      need(
        only(envelope, ['payload', 'signature']) &&
          record(envelope.payload) &&
          typeof envelope.signature === 'string',
        'EVIDENCE_ENVELOPE_INVALID',
      );
      const payload = envelope.payload;
      need(
        only(payload, [
          'kind',
          'mode',
          'issuer',
          'challenge',
          'issuedAt',
          'expiresAt',
          'observation',
        ]) &&
          payload.kind === kind &&
          payload.mode === mode &&
          payload.issuer === adapter.issuer,
        'EVIDENCE_ORIGIN_MISMATCH',
      );
      need(
        executionDigest(payload.challenge) === executionDigest(challenge),
        'EVIDENCE_CHALLENGE_MISMATCH',
      );
      need(
        verify(
          null,
          Buffer.from(executionJson(payload)),
          publicKey(adapter),
          Buffer.from(envelope.signature, 'base64url'),
        ),
        'EVIDENCE_SIGNATURE_INVALID',
      );
      fresh(payload);
      let archived;
      try {
        archived = await adapter.readArchivedEvidence(executionDigest(envelope), { tx });
      } catch {
        throw new MigrationExecutionError('EVIDENCE_ARCHIVE_UNAVAILABLE');
      }
      need(
        archived && executionDigest(archived) === executionDigest(envelope),
        'EVIDENCE_ARCHIVE_MISMATCH',
      );
      envelopes[kind] = envelope;
    }
    const identity = envelopes.identity.payload.observation,
      maintenance = envelopes.maintenance.payload.observation,
      permission = envelopes.authorization.payload.observation;
    need(
      only(identity, ['targetDigest', 'schemaDigest', 'codeSha', 'businessWriteCounter']) &&
        identity.targetDigest === facts.targetDigest &&
        identity.schemaDigest === facts.schemaDigest &&
        identity.codeSha === manifest.codeSha &&
        Number.isSafeInteger(identity.businessWriteCounter) &&
        identity.businessWriteCounter >= 0,
      'IDENTITY_OBSERVATION_MISMATCH',
    );
    need(
      only(maintenance, [
        'inventoryDigest',
        'requiredDomains',
        'sourceDigest',
        'writers',
        'inFlight',
        'fence',
        'checkpointDigest',
        'receiptJournalDigest',
        'receiptJournalIdDigest',
        'backupSetDigest',
      ]),
      'MAINTENANCE_FIELDS_INVALID',
    );
    need(
      record(maintenance) &&
        maintenance.inventoryDigest === manifest.inventoryDigest &&
        maintenance.sourceDigest === manifest.sourceDigest,
      'MAINTENANCE_SCOPE_MISMATCH',
    );
    need(
      Array.isArray(maintenance.requiredDomains) &&
        executionDigest(sorted(maintenance.requiredDomains)) ===
          executionDigest(manifest.requiredDomains),
      'DOMAIN_INVENTORY_MISMATCH',
    );
    need(
      Array.isArray(maintenance.writers) &&
        maintenance.writers.length === manifest.writerIds.length &&
        executionDigest(sorted(maintenance.writers.map((writer) => writer.id))) ===
          executionDigest(manifest.writerIds),
      'WRITER_INVENTORY_MISMATCH',
    );
    for (const writer of maintenance.writers)
      need(
        only(writer, ['id', 'state', 'generation', 'processDigest']) &&
          writer.state === 'stopped' &&
          HEX.test(writer.processDigest) &&
          Number.isSafeInteger(writer.generation) &&
          writer.generation >= 0,
        'WRITER_NOT_FENCED',
      );
    need(
      only(maintenance.inFlight, FLIGHTS) &&
        FLIGHTS.every((key) => maintenance.inFlight[key] === 0),
      'INFLIGHT_NOT_DRAINED',
    );
    need(
      only(maintenance.fence, ['runId', 'manifestDigest', 'epoch', 'expiresAt']) &&
        typeof maintenance.fence.expiresAt === 'string',
      'MAINTENANCE_FENCE_INVALID',
    );
    need(
      maintenance.fence?.runId === manifest.runId &&
        maintenance.fence?.manifestDigest === manifest.digest &&
        HEX.test(maintenance.fence?.epoch) &&
        Date.parse(maintenance.fence?.expiresAt) > now(),
      'MAINTENANCE_FENCE_INVALID',
    );
    for (const key of ['checkpointDigest', 'receiptJournalDigest', 'backupSetDigest'])
      need(HEX.test(maintenance[key]), 'RECOVERY_EVIDENCE_MISSING');
    need(
      maintenance.backupSetDigest === manifest.backupSetDigest &&
        maintenance.receiptJournalIdDigest === manifest.receiptJournalIdDigest,
      'RECOVERY_EVIDENCE_MISMATCH',
    );
    need(
      only(permission, [
        'grantId',
        'operation',
        'approverDigest',
        'policyDigest',
        'approvedDigest',
      ]) &&
        UUID.test(permission.grantId) &&
        permission.operation === operation &&
        permission.policyDigest === policyDigest &&
        HEX.test(permission.approverDigest) &&
        permission.approvedDigest === (unit?.digest ?? manifest.digest),
      'EXECUTION_NOT_AUTHORIZED',
    );
    return { challenge, envelopes, businessWriteCounter: identity.businessWriteCounter };
  }
  async function lock(tx, manifest) {
    const result = await tx.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended('legacy-migration-target:'||$1,0)) locked",
      [manifest.targetDigest],
    );
    need(result.rows[0]?.locked === true, 'EXECUTION_BUSY');
  }
  async function run(tx, manifest) {
    const row = (
      await tx.query('SELECT * FROM platform.legacy_migration_runs WHERE run_id=$1 FOR UPDATE', [
        manifest.runId,
      ])
    ).rows[0];
    need(
      row &&
        row.manifest_digest === manifest.digest &&
        row.target_digest === manifest.targetDigest &&
        row.mode === mode &&
        executionDigest(row.manifest) === executionDigest(manifest),
      'RUN_BINDING_MISMATCH',
    );
    return row;
  }
  async function evidence(tx, manifest, proof) {
    for (const envelope of Object.values(proof.envelopes)) fresh(envelope.payload);
    const payloads = Object.values(proof.envelopes).map((value) => value.payload);
    await tx.query(
      `INSERT INTO platform.legacy_migration_evidence(evidence_id,run_id,unit_key,operation,challenge_id,target_digest,identity_digest,maintenance_digest,authorization_digest,issuer_key_digests,observed_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
      [
        randomUUID(),
        manifest.runId,
        proof.challenge.unitKey,
        proof.challenge.operation,
        proof.challenge.nonce,
        manifest.targetDigest,
        executionDigest(proof.envelopes.identity),
        executionDigest(proof.envelopes.maintenance),
        executionDigest(proof.envelopes.authorization),
        JSON.stringify(
          Object.fromEntries(
            Object.entries(adapters).map(([kind, adapter]) => [
              kind,
              createHash('sha256')
                .update(publicKey(adapter).export({ type: 'spki', format: 'der' }))
                .digest('hex'),
            ]),
          ),
        ),
        new Date(Math.min(...payloads.map((item) => Date.parse(item.issuedAt)))),
        new Date(Math.min(...payloads.map((item) => Date.parse(item.expiresAt)))),
      ],
    );
  }
  async function inspected(handler, method, tx, payload, unit, manifest) {
    const observation = await handler[method](tx, payload);
    need(record(observation) && HEX.test(observation.stateDigest), 'HANDLER_OBSERVATION_INVALID');
    for (const [field, expected] of [
      ['sourceOwnerIds', unit.sourceOwnerDigests],
      ['targetOwnerIds', unit.targetOwnerDigests],
    ]) {
      need(
        Array.isArray(observation[field]) && observation[field].length > 0,
        'ACTUAL_OWNER_SCOPE_REQUIRED',
      );
      for (const owner of observation[field])
        assertLegacyMigrationOwnerAllowed(owner, options.additionalPreservedOwnerDigests);
      need(
        executionDigest(sorted(observation[field].map(legacyMigrationOwnerDigest))) ===
          executionDigest(expected),
        'ACTUAL_OWNER_SCOPE_MISMATCH',
      );
    }
    need(
      observation.planDigest === unit.planDigest &&
        observation.scopeDigest === unit.scopeDigest &&
        observation.sourceDigest === manifest.sourceDigest,
      'HANDLER_PLAN_SCOPE_MISMATCH',
    );
    need(
      executionDigest(eventsOf(observation.events)) === executionDigest(unit.events),
      'HANDLER_SOURCE_EVENTS_MISMATCH',
    );
    return observation;
  }
  async function unitRow(tx, manifest, unit) {
    const row = (
      await tx.query(
        'SELECT * FROM platform.legacy_migration_units WHERE run_id=$1 AND unit_key=$2 FOR UPDATE',
        [manifest.runId, unit.key],
      )
    ).rows[0];
    need(
      row &&
        row.unit_digest === unit.digest &&
        row.domain === unit.domain &&
        row.handler_digest === unit.handlerDigest &&
        row.plan_digest === unit.planDigest &&
        row.before_digest === unit.beforeDigest &&
        row.after_digest === unit.afterDigest,
      'UNIT_BINDING_MISMATCH',
    );
    return row;
  }
  const receiptDigest = (manifest, unit, status, counts) =>
    executionDigest({ runId: manifest.runId, unitDigest: unit.digest, status, counts });
  async function verifyCommitted(tx, manifest, unit, row, handler, payload) {
    need(
      row.receipt_digest === receiptDigest(manifest, unit, row.status, row.result_counts),
      'UNIT_RECEIPT_CORRUPT',
    );
    const after = await inspected(handler, 'inspectAfter', tx, payload, unit, manifest);
    need(after.stateDigest === unit.afterDigest, 'TARGET_CHANGED_AFTER_COMMIT');
    const events = (
      await tx.query(
        'SELECT event_key,event_digest,after_digest FROM platform.legacy_migration_events WHERE target_digest=$1 AND domain=$2 AND event_key=ANY($3::text[])',
        [manifest.targetDigest, unit.domain, unit.events.map((event) => event.key)],
      )
    ).rows;
    need(
      events.length === unit.events.length &&
        events.every(
          (event) =>
            unit.events.some(
              (expected) =>
                event.event_key === expected.key && event.event_digest === expected.digest,
            ) && event.after_digest === unit.afterDigest,
        ),
      'SOURCE_RECEIPT_CORRUPT',
    );
    return after;
  }
  async function prepare(input) {
    need(executable, 'EXECUTION_DISABLED');
    const manifest = validate(input);
    const proof = await gate(manifest, 'prepare', null);
    return database.transaction(async (tx) => {
      await lock(tx, manifest);
      const old = (
        await tx.query(
          'SELECT manifest_digest FROM platform.legacy_migration_runs WHERE run_id=$1',
          [manifest.runId],
        )
      ).rows[0];
      if (old) {
        await run(tx, manifest);
        return { status: 'already_prepared', runId: manifest.runId };
      }
      const active = await tx.query(
        "SELECT 1 FROM platform.legacy_migration_runs WHERE target_digest=$1 AND status IN ('prepared','executing','verified')",
        [manifest.targetDigest],
      );
      need(active.rows.length === 0, 'ANOTHER_RUN_IS_ACTIVE');
      await tx.query(
        `INSERT INTO platform.legacy_migration_runs(run_id,mode,manifest_digest,manifest,target_digest,source_digest,schema_digest,policy_digest,code_sha,status,baseline_business_counter)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,'prepared',$10)`,
        [
          manifest.runId,
          mode,
          manifest.digest,
          JSON.stringify(manifest),
          manifest.targetDigest,
          manifest.sourceDigest,
          manifest.schemaDigest,
          manifest.policyDigest,
          manifest.codeSha,
          proof.businessWriteCounter,
        ],
      );
      for (const unit of manifest.units)
        await tx.query(
          `INSERT INTO platform.legacy_migration_units(run_id,unit_key,unit_digest,domain,handler_digest,plan_digest,before_digest,after_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            manifest.runId,
            unit.key,
            unit.digest,
            unit.domain,
            unit.handlerDigest,
            unit.planDigest,
            unit.beforeDigest,
            unit.afterDigest,
          ],
        );
      await evidence(tx, manifest, proof);
      return { status: 'prepared', runId: manifest.runId };
    });
  }
  async function executeUnit(input, key, payload) {
    need(executable, 'EXECUTION_DISABLED');
    const manifest = validate(input),
      unit = manifest.units.find((value) => value.key === key);
    need(unit, 'UNIT_NOT_DECLARED');
    const handler = registry.get(unit.domain);
    const proof = await gate(manifest, 'execute', unit);
    try {
      return await database.transaction(async (tx) => {
        await lock(tx, manifest);
        const current = await run(tx, manifest);
        need(['prepared', 'executing', 'verified'].includes(current.status), 'RUN_NOT_EXECUTABLE');
        need(
          Number(current.baseline_business_counter) === proof.businessWriteCounter,
          'NEW_BUSINESS_WRITES_DETECTED',
        );
        const row = await unitRow(tx, manifest, unit);
        if (row.status !== 'pending') {
          await verifyCommitted(tx, manifest, unit, row, handler, payload);
          await evidence(tx, manifest, proof);
          return { status: 'already_applied', counts: row.result_counts };
        }
        const dependencies = await tx.query(
          "SELECT unit_key FROM platform.legacy_migration_units WHERE run_id=$1 AND unit_key=ANY($2::text[]) AND status<>'pending'",
          [manifest.runId, unit.dependsOn],
        );
        need(dependencies.rows.length === unit.dependsOn.length, 'DEPENDENCY_NOT_COMMITTED');
        const before = await inspected(handler, 'inspect', tx, payload, unit, manifest);
        const prior = (
          await tx.query(
            'SELECT event_key,event_digest,after_digest FROM platform.legacy_migration_events WHERE target_digest=$1 AND domain=$2 AND event_key=ANY($3::text[])',
            [manifest.targetDigest, unit.domain, unit.events.map((event) => event.key)],
          )
        ).rows;
        need(
          prior.every((event) =>
            unit.events.some(
              (expected) =>
                event.event_key === expected.key && event.event_digest === expected.digest,
            ),
          ),
          'SOURCE_EVENT_CHANGED',
        );
        let status, counts;
        if (prior.length) {
          need(prior.length === unit.events.length, 'PARTIAL_EVENT_SET_REPLAN_REQUIRED');
          need(
            prior.every((event) => event.after_digest === unit.afterDigest) &&
              before.stateDigest === unit.afterDigest,
            'TARGET_CHANGED_AFTER_COMMIT',
          );
          status = 'reused';
          counts = {};
        } else {
          need(before.stateDigest === unit.beforeDigest, 'TARGET_CHANGED_BEFORE_APPLY');
          await tx.query("SELECT set_config('weiban.legacy_migration_run',$1,true)", [
            manifest.runId,
          ]);
          executionTransactions.set(
            tx,
            Object.freeze({
              mode,
              runId: manifest.runId,
              unitKey: unit.key,
              domain: unit.domain,
              targetDigest: manifest.targetDigest,
              sourceDigest: manifest.sourceDigest,
              manifestDigest: manifest.digest,
              planDigest: unit.planDigest,
              scopeDigest: unit.scopeDigest,
              handlerDigest: unit.handlerDigest,
              policyDigest,
            }),
          );
          try {
            counts = validCounts(await handler.apply(tx, payload), handler.metrics);
          } finally {
            executionTransactions.delete(tx);
          }
          const after = await inspected(handler, 'inspectAfter', tx, payload, unit, manifest);
          need(after.stateDigest === unit.afterDigest, 'POSTCONDITION_MISMATCH');
          status = 'applied';
          for (const event of unit.events)
            await tx.query(
              `INSERT INTO platform.legacy_migration_events(target_digest,domain,event_key,event_digest,run_id,unit_key,unit_digest,after_digest)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
              [
                manifest.targetDigest,
                unit.domain,
                event.key,
                event.digest,
                manifest.runId,
                unit.key,
                unit.digest,
                unit.afterDigest,
              ],
            );
        }
        const finalProof = await gate(manifest, 'execute', unit, tx);
        need(
          finalProof.businessWriteCounter === Number(current.baseline_business_counter),
          'NEW_BUSINESS_WRITES_DETECTED',
        );
        await tx.query(
          'UPDATE platform.legacy_migration_units SET status=$3,receipt_digest=$4,result_counts=$5::jsonb,committed_at=now() WHERE run_id=$1 AND unit_key=$2',
          [
            manifest.runId,
            unit.key,
            status,
            receiptDigest(manifest, unit, status, counts),
            JSON.stringify(counts),
          ],
        );
        await tx.query(
          "UPDATE platform.legacy_migration_runs SET status='executing',updated_at=now() WHERE run_id=$1",
          [manifest.runId],
        );
        await evidence(tx, manifest, proof);
        await evidence(tx, manifest, finalProof);
        return { status, counts };
      });
    } catch (error) {
      // A COMMIT response can be lost. Never infer rollback from the transport error.
      const code =
        error instanceof MigrationExecutionError
          ? error.code
          : ['LEGACY_MIGRATION_OWNER_PRESERVED', 'LEGACY_MIGRATION_OWNER_REQUIRED'].includes(
                error?.message,
              )
            ? error.message
            : 'ADAPTER_OR_CONNECTION_FAILURE';
      if (code === 'EXECUTION_BUSY') throw new MigrationExecutionError(code);
      await database
        .query(
          `INSERT INTO platform.legacy_migration_attempts(attempt_id,run_id,unit_key,outcome,failure_code)
        SELECT $1,$2,$3,'unconfirmed',$4 WHERE EXISTS(SELECT 1 FROM platform.legacy_migration_units WHERE run_id=$2 AND unit_key=$3)`,
          [randomUUID(), manifest.runId, unit.key, code],
        )
        .catch(() => undefined);
      throw new MigrationExecutionError(code);
    }
  }
  async function reconcile(input, payloadForUnit) {
    need(executable, 'EXECUTION_DISABLED');
    const manifest = validate(input);
    const proof = await gate(manifest, 'reconcile', null);
    return database.transaction(async (tx) => {
      await lock(tx, manifest);
      const current = await run(tx, manifest);
      need(current.status !== 'released', 'RUN_ALREADY_RELEASED');
      need(
        Number(current.baseline_business_counter) === proof.businessWriteCounter,
        'NEW_BUSINESS_WRITES_DETECTED',
      );
      let committed = 0,
        retryable = 0,
        waiting = 0;
      for (const unit of manifest.units) {
        const row = await unitRow(tx, manifest, unit),
          handler = registry.get(unit.domain);
        const dependencies = await tx.query(
          "SELECT count(*)::int n FROM platform.legacy_migration_units WHERE run_id=$1 AND unit_key=ANY($2::text[]) AND status='pending'",
          [manifest.runId, unit.dependsOn],
        );
        if (row.status === 'pending' && dependencies.rows[0].n > 0) {
          waiting++;
          continue;
        }
        const payload = await payloadForUnit(unit.key);
        let observed;
        if (row.status !== 'pending') {
          observed = await verifyCommitted(tx, manifest, unit, row, handler, payload);
          committed++;
        } else {
          observed = await inspected(handler, 'inspect', tx, payload, unit, manifest);
          need(observed.stateDigest === unit.beforeDigest, 'UNRECEIPTED_TARGET_CHANGE');
          retryable++;
        }
        await tx.query(
          'INSERT INTO platform.legacy_migration_attempts(attempt_id,run_id,unit_key,outcome,observed_digest) VALUES($1,$2,$3,$4,$5)',
          [
            randomUUID(),
            manifest.runId,
            unit.key,
            row.status === 'pending' ? 'retryable' : 'recovered',
            observed.stateDigest,
          ],
        );
      }
      if (committed === manifest.units.length)
        await tx.query(
          "UPDATE platform.legacy_migration_runs SET status=CASE WHEN status IN ('closed','halted') THEN status ELSE 'verified' END,updated_at=now() WHERE run_id=$1",
          [manifest.runId],
        );
      await evidence(tx, manifest, proof);
      return { committed, retryable, waiting };
    });
  }
  async function transition(input, operation, payloadForUnit) {
    need(executable, 'EXECUTION_DISABLED');
    const manifest = validate(input),
      proof = await gate(manifest, operation, null);
    return database.transaction(async (tx) => {
      await lock(tx, manifest);
      const current = await run(tx, manifest);
      if (operation !== 'halt')
        need(
          Number(current.baseline_business_counter) === proof.businessWriteCounter,
          'NEW_BUSINESS_WRITES_DETECTED',
        );
      if (operation === 'restore-check') {
        const otherActive = await tx.query(
          "SELECT 1 FROM platform.legacy_migration_runs WHERE target_digest=$1 AND run_id<>$2 AND status IN ('prepared','executing','verified') LIMIT 1",
          [manifest.targetDigest, manifest.runId],
        );
        need(otherActive.rows.length === 0, 'OTHER_ACTIVE_RUN_BLOCKS_RESTORE');
        const released = await tx.query(
          'SELECT 1 FROM platform.legacy_migration_runs WHERE target_digest=$1 AND released_at IS NOT NULL AND released_at >= (SELECT created_at FROM platform.legacy_migration_runs WHERE run_id=$2) LIMIT 1',
          [manifest.targetDigest, manifest.runId],
        );
        need(
          current.status !== 'released' && released.rows.length === 0,
          'BLIND_RESTORE_AFTER_RELEASE_FORBIDDEN',
        );
        await evidence(tx, manifest, proof);
        return {
          eligible: true,
          executed: false,
          requiredAdapter: 'external-matching-baseline-restore-with-preserved-ledger',
        };
      }
      if (operation === 'halt') need(current.status !== 'released', 'RUN_ALREADY_RELEASED');
      else {
        need(current.status === 'verified' || current.status === 'closed', 'RUN_NOT_VERIFIED');
        need(typeof payloadForUnit === 'function', 'POSTCONDITION_READER_REQUIRED');
        for (const unit of manifest.units) {
          const row = await unitRow(tx, manifest, unit);
          need(row.status !== 'pending', 'UNIT_NOT_COMMITTED');
          await verifyCommitted(
            tx,
            manifest,
            unit,
            row,
            registry.get(unit.domain),
            await payloadForUnit(unit.key),
          );
        }
      }
      const status =
        operation === 'release' ? 'released' : operation === 'halt' ? 'halted' : 'closed';
      await tx.query(
        "UPDATE platform.legacy_migration_runs SET status=$2,updated_at=now(),released_at=CASE WHEN $2='released' THEN now() ELSE released_at END WHERE run_id=$1",
        [manifest.runId, status],
      );
      const finalProof = await gate(manifest, operation, null, tx);
      if (operation !== 'halt')
        need(
          finalProof.businessWriteCounter === Number(current.baseline_business_counter),
          'NEW_BUSINESS_WRITES_DETECTED',
        );
      await evidence(tx, manifest, proof);
      await evidence(tx, manifest, finalProof);
      return { status, servicesChanged: false };
    });
  }
  return Object.freeze({
    mode,
    prepare,
    executeUnit,
    reconcile,
    close: (manifest, payloadForUnit) => transition(manifest, 'close', payloadForUnit),
    markReleased: (manifest, payloadForUnit) => transition(manifest, 'release', payloadForUnit),
    halt: (manifest) => transition(manifest, 'halt'),
    assertRestoreEligible: (manifest) => transition(manifest, 'restore-check'),
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  need(
    process.argv.slice(2).every((arg) => arg === '--plan'),
    'NO_EXECUTION_CLI',
  );
  process.stdout.write(
    JSON.stringify({
      mode: 'plan',
      productionAdapters: 'not-shipped',
      connectionDiscovery: false,
      automaticCutover: false,
      restoreExecutor: 'not-shipped',
    }) + '\n',
  );
}
