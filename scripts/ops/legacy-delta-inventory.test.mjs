import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryDigest,
  migrationDomainRule,
  planMigrationInventory,
  readExportWhitelist,
  schemaFromSources,
  syntheticSchema,
} from './legacy-delta-inventory.mjs';

const sql = `
CREATE TABLE app_users (id TEXT PRIMARY KEY, password_hash TEXT, recovery_code_hash TEXT, membership_expire_at TEXT);
CREATE TABLE chat_history (id INTEGER PRIMARY KEY, user_id TEXT, content TEXT, deleted_at TEXT);
CREATE TABLE group_memories (id TEXT PRIMARY KEY, group_id TEXT, subject_character_id TEXT, enabled INTEGER);
CREATE TABLE user_stickers (id TEXT PRIMARY KEY, user_id TEXT, image_url TEXT, slot TEXT, is_public INTEGER);
CREATE TABLE weibo_bindings (id TEXT PRIMARY KEY, user_id TEXT, slot TEXT);
CREATE TABLE membership_orders (id TEXT PRIMARY KEY, user_id TEXT, status TEXT);
`;
const python = `queries = {
  'app_users': 'SELECT id,membership_expire_at FROM app_users ORDER BY id',
  'chat_history': 'SELECT * FROM chat_history ORDER BY id',
}`;
const proof = (label) => inventoryDigest(['synthetic-only', label]);
const window = {
  from: '2026-10-24T12:02:47.000Z',
  to: '2026-11-09T01:00:00.000Z',
  sourceBaselineDigest: proof('source-baseline'),
  sourceFinalDigest: proof('source-final'),
  targetBaselineDigest: proof('target-baseline'),
};
function stamp(stream) {
  stream.itemsDigest = inventoryDigest(stream.items);
}
function fixture(schema = syntheticSchema(sql), previousSchema = schema) {
  const exporter = readExportWhitelist(python);
  const input = { schema, previousSchema, exporter, window, decisions: {}, events: {} };
  const initial = planMigrationInventory(input);
  for (const row of initial.inventory.filter((item) => item.domain)) {
    input.decisions[row.table] = {
      action: row.allowedActions[0],
      schemaDigest: schema.digest,
      tableDigest: row.schemaDigest,
      exporterDigest: exporter.digest,
      proofs: Object.fromEntries(
        [...row.requiredEvidence, 'user-or-operator-instructions'].map((key) => [
          key,
          proof(`${row.table}:${key}`),
        ]),
      ),
      productDecisionDigest: proof(`${row.table}:decision`),
      capabilityStatus: 'enabled-and-verified',
      capabilityEvidenceDigest: proof(`${row.table}:capability`),
      columns: Object.fromEntries(
        (schema.tables.find((table) => table.name === row.table)?.columns ?? []).map((column) => [
          column.name,
          {
            action:
              column.name === 'recovery_code_hash'
                ? 'exclude-reviewed'
                : /password/.test(column.name)
                  ? 'protect-target'
                  : 'map',
            target: `synthetic.${row.domain}.${column.name}`,
            proofDigest: proof(`column:${row.table}:${column.name}`),
            decisionDigest: proof('confirmed-recovery-retirement-2026-11-09'),
          },
        ]),
      ),
    };
  }
  const deletion = {
    eventKey: proof('delete-event'),
    ownerKey: proof('owner'),
    occurredAt: '2026-11-08T03:00:00.000Z',
    action: 'approved-hide',
    sourceObjectKey: proof('source-message'),
    mappingProofDigest: proof('fragment-mapping'),
    targetBarrierDigest: proof('target-delete-barrier'),
    relatedTargetKeys: [proof('fragment1'), proof('fragment2')],
    decisionDigest: proof('approved-deletion-scope'),
  };
  deletion.relatedTargetSetDigest = inventoryDigest([...deletion.relatedTargetKeys].sort());
  deletion.expectedTargetSetDigest = deletion.relatedTargetSetDigest;
  const password = {
    eventKey: proof('password-event'),
    ownerKey: proof('owner'),
    occurredAt: '2026-11-08T03:01:00.000Z',
    action: 'preserve-target',
    baselineCredentialFingerprint: proof('old-target-password-fingerprint'),
    sourceCredentialFingerprint: proof('source-password-fingerprint'),
    targetCredentialFingerprint: proof('new-target-password-fingerprint'),
    comparisonProofDigest: proof('credential-three-way-comparison'),
    targetScheme: 'argon2id',
    resultScheme: 'argon2id',
  };
  const entitlement = {
    eventKey: proof('entitlement-event'),
    ownerKey: proof('owner'),
    occurredAt: '2026-11-08T03:02:00.000Z',
    action: 'apply-reviewed-uncredited',
    sourceOrderKey: proof('source-order'),
    paymentReceiptDigest: proof('payment-receipt'),
    priorImportReceiptDigest: proof('initial-import-receipt'),
    targetLedgerReceiptDigest: proof('new-ledger-review'),
    approvedDeltaDigest: proof('approved-uncredited-benefit'),
    decisionDigest: proof('benefit-decision'),
    paymentStatus: 'settled',
    refundStatus: 'none',
  };
  entitlement.deduplicationKey = inventoryDigest(['legacy-entitlement', entitlement.eventKey]);
  for (const [kind, event] of Object.entries({
    deletions: deletion,
    passwords: password,
    entitlements: entitlement,
  })) {
    input.events[kind] = {
      coverage: {
        ...window,
        schemaDigest: schema.digest,
        exporterDigest: exporter.digest,
        scanManifestDigest: proof(`${kind}:complete-scan`),
      },
      items: [event],
      emptyScanProofDigest: proof(`${kind}:empty-scan`),
    };
    stamp(input.events[kind]);
    input.events[kind].coverage.expectedEventSetDigest = inventoryDigest([event.eventKey]);
  }
  return input;
}
function codes(plan) {
  return new Set(plan.blockers.map((item) => item.code));
}
function blocked(input, code) {
  const plan = planMigrationInventory(input);
  assert.equal(plan.status, 'blocked');
  assert.ok(codes(plan).has(code), `${code}: ${JSON.stringify(plan.blockers)}`);
  return plan;
}

test('source scanning parses JS without evaluation and ignores comments, regex text and SQL value strings', () => {
  const source =
    "throw new Error('must never execute');\n// CREATE TABLE imagined (id TEXT);\nconst regex = /[\"']/g;\ndb.exec(`CREATE TABLE group_memories (id TEXT PRIMARY KEY, note TEXT DEFAULT 'CREATE TABLE fake (id TEXT)');`);";
  const schema = schemaFromSources([{ name: 'server/example.js', text: source }]);
  assert.deepEqual(
    schema.tables.map((table) => table.name),
    ['group_memories'],
  );
  assert.deepEqual(
    schema.tables[0].columns.map((column) => column.name),
    ['id', 'note'],
  );
  assert.equal(schema.kind, 'source-static');
});

test('dynamic DDL remains an explicit unresolved block instead of silently claiming complete live schema', () => {
  const schema = schemaFromSources([
    {
      name: 'server/example.js',
      text: 'db.exec(`CREATE TABLE group_memories (id TEXT); ALTER TABLE group_memories ADD COLUMN ${name} ${ddl}`);',
    },
  ]);
  const plan = planMigrationInventory({
    schema,
    exporter: readExportWhitelist(
      "queries = {\n'group_memories': 'SELECT * FROM group_memories',\n}",
    ),
  });
  assert.ok(codes(plan).has('SOURCE_SCHEMA_NOT_RUNTIME_VERIFIED'));
  assert.ok(codes(plan).has('MIGRATION_DDL_REQUIRES_FINAL_SCHEMA'));
  assert.ok(codes(plan).has('BASELINE_SCHEMA_REQUIRED'));
});

test('the actual exporter format is parsed as projections rather than table counts', () => {
  const whitelist = readExportWhitelist(python);
  assert.deepEqual(whitelist.entries, [
    { table: 'app_users', columns: ['id', 'membership_expire_at'] },
    { table: 'chat_history', columns: '*' },
  ]);
  for (const unsupported of [
    "queries = {\n'x': 'SELECT * FROM other',\n}",
    "queries = {\n'x': f'SELECT * FROM {table}',\n}",
    "queries = {\n'x': 'SELECT * FROM x WHERE enabled=1',\n}",
    "queries = {\n'x': 'SELECT * FROM x',\n'x': 'SELECT * FROM x',\n}",
  ])
    assert.throws(() => readExportWhitelist(unsupported), /UNSUPPORTED_EXPORT_QUERY/);
});

test('fully evidenced synthetic plan stays explicitly nonproduction and includes omitted fields and local domains', () => {
  const plan = planMigrationInventory(fixture());
  assert.equal(plan.status, 'planned-for-synthetic-rehearsal');
  assert.equal(plan.productionReady, false);
  assert.equal(plan.summary.tables, 6);
  assert.equal(plan.summary.exportedTables, 2);
  assert.equal(plan.summary.notInExporter, 4);
  assert.equal(plan.summary.virtualDomains, 2);
  assert.deepEqual(plan.inventory.find((row) => row.table === 'app_users').omittedColumns, [
    'password_hash',
    'recovery_code_hash',
  ]);
  assert.equal(plan.inventory.find((row) => row.table === 'group_memories').domain, 'group_memory');
  assert.equal(plan.inventory.find((row) => row.table === 'user_stickers').domain, 'stickers');
});

test('unknown table always blocks even if a caller supplies a generic mapping', () => {
  const schema = syntheticSchema(
    sql + 'CREATE TABLE surprising_user_data (id TEXT, content TEXT);',
  );
  const input = fixture(schema, syntheticSchema(sql));
  input.decisions.surprising_user_data = { action: 'map-protected', proofs: { count: 0 } };
  const plan = blocked(input, 'UNCLASSIFIED_TABLE');
  assert.ok(codes(plan).has('SCHEMA_TABLE_ADDED'));
});

test('known but newly added tables require a schema review', () => {
  const input = fixture(
    syntheticSchema(sql + 'CREATE TABLE user_client_prefs (user_id TEXT, prefs_json TEXT);'),
    syntheticSchema(sql),
  );
  const plan = blocked(input, 'SCHEMA_TABLE_ADDED');
  assert.equal(plan.inventory.find((row) => row.table === 'user_client_prefs').status, 'blocked');
});

test('added, changed, removed columns and changed table constraints each block wildcard exports too', () => {
  for (const [changed, code] of [
    [
      sql.replace('content TEXT, deleted_at', 'content TEXT, private_setting TEXT, deleted_at'),
      'SCHEMA_COLUMN_ADDED',
    ],
    [sql.replace('content TEXT, deleted_at', 'content BLOB, deleted_at'), 'SCHEMA_COLUMN_CHANGED'],
    [sql.replace('content TEXT, ', ''), 'SCHEMA_COLUMN_REMOVED'],
    [
      sql.replace(
        'content TEXT, deleted_at TEXT)',
        'content TEXT, deleted_at TEXT, UNIQUE(user_id, id))',
      ),
      'SCHEMA_CONSTRAINT_CHANGED',
    ],
  ])
    blocked(fixture(syntheticSchema(changed), syntheticSchema(sql)), code);
});

test('removed source table and now-invalid explicit exporter columns block planning', () => {
  blocked(
    fixture(
      syntheticSchema(sql.replace(/CREATE TABLE group_memories[^;]+;/u, '')),
      syntheticSchema(sql),
    ),
    'SCHEMA_TABLE_REMOVED',
  );
  blocked(
    fixture(syntheticSchema(sql.replace(', membership_expire_at TEXT', ''))),
    'EXPORTED_COLUMN_MISSING',
  );
});

test('uncovered group memories and stickers cannot be waived by zero counts or covered message-media totals', () => {
  for (const table of ['group_memories', 'user_stickers']) {
    const input = fixture();
    delete input.decisions[table];
    input.counts = { [table]: 0, media: 1000 };
    blocked(input, 'UNCOVERED_TABLE_DISPOSITION_REQUIRED');
  }
});

test('domain-specific group ownership and sticker slot/prior-import protections are required', () => {
  for (const [table, key] of [
    ['group_memories', 'group-subject-owner-map'],
    ['group_memories', 'unassigned-subject-decisions'],
    ['user_stickers', 'prior-sticker-import-receipts'],
    ['user_stickers', 'persona-slot-visibility-map'],
  ]) {
    const input = fixture();
    delete input.decisions[table].proofs[key];
    const plan = blocked(input, 'DOMAIN_EVIDENCE_REQUIRED');
    assert.ok(plan.blockers.some((item) => item.scope === table && item.detail === key));
  }
});

test('projection omission still requires column disposition and disallows direct credential copying', () => {
  const missing = fixture();
  delete missing.decisions.app_users.columns.recovery_code_hash;
  blocked(missing, 'COLUMN_DISPOSITION_REQUIRED');
  const rawCopy = fixture();
  rawCopy.decisions.app_users.columns.password_hash.action = 'map';
  blocked(rawCopy, 'SENSITIVE_FIELD_DIRECT_COPY_FORBIDDEN');
});

test('old decisions cannot silently approve a changed schema or exporter', () => {
  const input = fixture();
  input.decisions.group_memories.schemaDigest = proof('old-schema');
  blocked(input, 'DISPOSITION_BASELINE_MISMATCH');
  const forged = fixture();
  forged.schema.tables[0].columns.pop();
  assert.throws(() => planMigrationInventory(forged), /INVALID_SCHEMA_DIGEST/);
});

test('retaining user content and device-only data needs a concrete product disposition and instructions', () => {
  const input = fixture();
  input.decisions.group_memories.action = 'retain-reviewed';
  delete input.decisions.group_memories.productDecisionDigest;
  blocked(input, 'REVIEWED_DISPOSITION_DECISION_REQUIRED');
  const local = fixture();
  delete local.decisions['@local_device'];
  blocked(local, 'DOMAIN_DISPOSITION_REQUIRED');
});

test('confirmed legacy recovery-code retirement forbids carrying codes forward and preserves current recovery', () => {
  const input = fixture();
  assert.equal(input.decisions['@recovery_codes'].action, 'do-not-carry-forward');
  input.decisions['@recovery_codes'].action = 'map-protected';
  blocked(input, 'DISPOSITION_NOT_ALLOWED');
  const copying = fixture();
  copying.decisions.app_users.columns.recovery_code_hash.action = 'retain-encrypted';
  blocked(copying, 'RECOVERY_CODE_RETIREMENT_REQUIRED');
  const currentRecovery = fixture();
  delete currentRecovery.decisions['@recovery_codes'].proofs['preserve-current-account-recovery'];
  blocked(currentRecovery, 'DOMAIN_EVIDENCE_REQUIRED');
  const exportedRecovery = fixture();
  exportedRecovery.exporter = readExportWhitelist(
    python.replace('SELECT id,membership_expire_at', 'SELECT *'),
  );
  blocked(exportedRecovery, 'RETIRED_RECOVERY_FIELD_EXPORTED');
});

test('required old message favorites need an accessible preserved/imported result, not only the old container', () => {
  const input = fixture();
  assert.equal(input.decisions['@local_device'].action, 'preserve-required-favorites');
  delete input.decisions['@local_device'].proofs['favorite-supported-read-or-import'];
  blocked(input, 'DOMAIN_EVIDENCE_REQUIRED');
  const retainOnly = fixture();
  retainOnly.decisions['@local_device'].action = 'retain-reviewed';
  blocked(retainOnly, 'DISPOSITION_NOT_ALLOWED');
});

test('unimplemented channels cannot be labeled rebind-ready and the old multi-slot gap requires evidence', () => {
  const input = fixture();
  input.decisions.weibo_bindings.capabilityStatus = 'not-integrated';
  blocked(input, 'REBIND_CAPABILITY_NOT_VERIFIED');
  const slots = fixture();
  delete slots.decisions.weibo_bindings.proofs['multi-slot-resolution'];
  blocked(slots, 'DOMAIN_EVIDENCE_REQUIRED');
});

test('aggregate counts and booleans do not replace deletion, password or entitlement event ledgers', () => {
  for (const kind of ['deletions', 'passwords', 'entitlements']) {
    const input = fixture();
    input.events[kind] = { count: 0, complete: true };
    blocked(input, 'EVENT_LEDGER_REQUIRED');
  }
});

test('empty event ledgers require a bound scan proof', () => {
  const input = fixture();
  input.events.deletions.items = [];
  stamp(input.events.deletions);
  input.events.deletions.coverage.expectedEventSetDigest = inventoryDigest([]);
  delete input.events.deletions.emptyScanProofDigest;
  blocked(input, 'EMPTY_EVENT_SCAN_PROOF_REQUIRED');
  input.events.deletions.emptyScanProofDigest = proof('verified-empty-scan');
  assert.equal(planMigrationInventory(input).status, 'planned-for-synthetic-rehearsal');
});

test('event ledger mutation, stale snapshot coverage and repeated event identities block', () => {
  const mutated = fixture();
  mutated.events.deletions.items[0].ownerKey = proof('different-owner');
  blocked(mutated, 'EVENT_LEDGER_DIGEST_MISMATCH');
  const stale = fixture();
  stale.events.passwords.coverage.targetBaselineDigest = proof('old-target');
  blocked(stale, 'EVENT_COVERAGE_MISMATCH');
  const repeat = fixture();
  repeat.events.entitlements.items.push(structuredClone(repeat.events.entitlements.items[0]));
  stamp(repeat.events.entitlements);
  blocked(repeat, 'INVALID_OR_DUPLICATE_EVENT_ID');
});

test('deletion impact must include every fragment and approved hiding needs a specific decision', () => {
  const incomplete = fixture();
  incomplete.events.deletions.items[0].relatedTargetKeys.pop();
  stamp(incomplete.events.deletions);
  blocked(incomplete, 'DELETION_IMPACT_EVIDENCE_REQUIRED');
  const unapproved = fixture();
  delete unapproved.events.deletions.items[0].decisionDigest;
  stamp(unapproved.events.deletions);
  blocked(unapproved, 'DELETION_EXPLICIT_DECISION_REQUIRED');
});

test('password changes preserve new target credentials and prevent algorithm rollback', () => {
  const overwrite = fixture();
  overwrite.events.passwords.items[0].action = 'reviewed-source-change';
  stamp(overwrite.events.passwords);
  blocked(overwrite, 'NEW_PASSWORD_MUST_BE_PRESERVED');
  const downgrade = fixture();
  downgrade.events.passwords.items[0].resultScheme = 'bcrypt';
  stamp(downgrade.events.passwords);
  blocked(downgrade, 'PASSWORD_ALGORITHM_DOWNGRADE_FORBIDDEN');
});

test('legacy password difference alone is not a source-change event, and new-account import needs absence proof', () => {
  const input = fixture();
  const password = input.events.passwords.items[0];
  password.action = 'reviewed-source-change';
  password.targetCredentialFingerprint = password.baselineCredentialFingerprint;
  stamp(input.events.passwords);
  blocked(input, 'PASSWORD_SOURCE_CHANGE_EVENT_REQUIRED');
  const missingAccount = fixture();
  missingAccount.events.passwords.items[0].action = 'import-new-account';
  stamp(missingAccount.events.passwords);
  blocked(missingAccount, 'NEW_ACCOUNT_ABSENCE_EVIDENCE_REQUIRED');
});

test('entitlements require order/payment/prior-import/new-ledger evidence and settled uncredited decision', () => {
  for (const field of [
    'sourceOrderKey',
    'paymentReceiptDigest',
    'priorImportReceiptDigest',
    'targetLedgerReceiptDigest',
  ]) {
    const input = fixture();
    delete input.events.entitlements.items[0][field];
    stamp(input.events.entitlements);
    blocked(input, 'ENTITLEMENT_EVENT_CHAIN_REQUIRED');
  }
  const refunded = fixture();
  refunded.events.entitlements.items[0].refundStatus = 'refunded';
  stamp(refunded.events.entitlements);
  blocked(refunded, 'UNCREDITED_ENTITLEMENT_DECISION_REQUIRED');
});

test('event cutoffs use real UTC instants and reject changed/ambiguous windows', () => {
  const input = fixture();
  input.events.deletions.items[0].occurredAt = '2026-11-09T01:00:00Z';
  stamp(input.events.deletions);
  assert.equal(planMigrationInventory(input).status, 'planned-for-synthetic-rehearsal');
  input.events.deletions.items[0].occurredAt = '2026-11-09T01:00:00.001Z';
  stamp(input.events.deletions);
  blocked(input, 'EVENT_OUTSIDE_WINDOW');
  const ambiguous = fixture();
  ambiguous.window = { ...window, from: '2026-10-24 12:02:47' };
  blocked(ambiguous, 'MIGRATION_WINDOW_BASELINES_REQUIRED');
});

test('rules forbid replaying pending work or treating usage counts as wallet funds', () => {
  assert.deepEqual(migrationDomainRule('chat_reply_jobs').actions, ['drain-and-archive']);
  assert.ok(migrationDomainRule('usage_counters').requires.includes('usage-is-not-wallet'));
  assert.ok(migrationDomainRule('device_bindings').requires.includes('no-old-token-import'));
  assert.equal(migrationDomainRule('brand_new_table'), null);
});

test('output never echoes arbitrary private evidence or caller-provided free text', () => {
  const input = fixture();
  input.decisions.group_memories.action = 'private-sentinel-never-output';
  input.events.passwords.items[0].rawPassword = 'private-sentinel-never-output';
  stamp(input.events.passwords);
  const result = planMigrationInventory(input);
  assert.ok(codes(result).has('UNEXPECTED_EVENT_FIELD'));
  assert.equal(JSON.stringify(result).includes('private-sentinel-never-output'), false);
  assert.equal(result.productionReady, false);
});

test('dropping events cannot be hidden by recalculating a smaller ledger digest', () => {
  const input = fixture();
  input.events.deletions.items = [];
  stamp(input.events.deletions);
  blocked(input, 'EVENT_SET_INCOMPLETE');
});

test('the same paid order cannot grant uncredited benefits twice under different event IDs', () => {
  const input = fixture();
  const duplicate = structuredClone(input.events.entitlements.items[0]);
  duplicate.eventKey = proof('another-event-same-order');
  duplicate.deduplicationKey = inventoryDigest(['legacy-entitlement', duplicate.eventKey]);
  input.events.entitlements.items.push(duplicate);
  input.events.entitlements.coverage.expectedEventSetDigest = inventoryDigest(
    input.events.entitlements.items.map((event) => event.eventKey).sort(),
  );
  stamp(input.events.entitlements);
  blocked(input, 'DUPLICATE_ENTITLEMENT_ORDER');
});
