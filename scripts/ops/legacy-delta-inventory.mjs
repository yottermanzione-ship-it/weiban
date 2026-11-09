/** Schema and migration-domain planning only. No database, network, import or private data reader. */
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HEX = /^[a-f0-9]{64}$/u;
const NAME = /^[a-z][a-z0-9_]*$/u;
const EVIDENCE = [
  'owner-map',
  'stable-source-ids',
  'target-baseline',
  'three-way-comparison',
  'deletion-barriers',
  'no-history-side-effects',
];
// Runtime-only legacy tables reviewed against old-weiban 2c5632e2; these are
// archive obligations, never substitutes for current chat or membership models.
const RETIRED_TABLES = {
  chat_messages: { domain: 'retired_chat_messages', sensitiveColumns: [] },
  licenses: { domain: 'retired_licenses', sensitiveColumns: ['source_cdk'] },
  cdks: { domain: 'retired_cdks', sensitiveColumns: ['code'] },
};
const RETIRED_EVIDENCE = [
  'recoverable-encrypted-archive',
  'original-database-preservation',
  'matching-backup-preservation',
  'no-runtime-business-consumers',
  'no-business-redemption-entitlement-or-replay',
  'no-deletion-without-explicit-instruction',
];
const RETIRED_PROHIBITIONS = [
  'restore-business',
  'redeem-code',
  'grant-entitlement',
  'replay',
  'discard-as-seed',
  'delete-original',
  'drop-table',
  'export-plaintext',
];
const RULES = [
  [
    'accounts',
    'app_users users user_uid_sequence',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'account-state-events', 'username-conflicts'],
  ],
  [
    'characters',
    'personas persona_packages character_assets characters_v2 character_lorebook_entries character_example_dialogues character_rename_events',
    ['reconcile-existing', 'retain-reviewed'],
    [...EVIDENCE, 'official-identity-map', 'preserve-new-catalog'],
  ],
  [
    'relationships',
    'user_friends friend_requests chat_groups chat_group_members relationship_states relationship_interaction_events',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'friend-removal-barriers', 'group-owner-member-map'],
  ],
  [
    'messages',
    'chat_history group_messages chat_read_cursors chat_user_visible_events',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'stable-message-and-quote-map', 'split-fragment-map', 'cursor-pagination-resync'],
  ],
  [
    'personal_memory',
    'user_memories conversation_summaries persona_memory_tombstones memory_extraction_events',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'memory-scope-map', 'disabled-and-superseded-map', 'no-paid-reextraction'],
  ],
  [
    'group_memory',
    'group_memories',
    ['map-protected', 'retain-reviewed'],
    [
      ...EVIDENCE,
      'group-subject-owner-map',
      'unassigned-subject-decisions',
      'disabled-and-superseded-map',
      'no-paid-reextraction',
    ],
  ],
  [
    'persona_state',
    'persona_overlays persona_base_versions persona_sync_ops persona_customizations persona_customization_commands persona_state_changes user_persona_backups',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'backup-customization-dedup', 'new-edit-protection'],
  ],
  [
    'preferences',
    'user_client_prefs',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'field-conflict-map', 'new-preference-protection'],
  ],
  [
    'moments',
    'moments moment_interactions',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'visibility-and-owner-map', 'post-interaction-deletion-map'],
  ],
  [
    'stickers',
    'sticker_catalog user_stickers user_sticker_pack_pins',
    ['map-protected', 'retain-reviewed'],
    [
      ...EVIDENCE,
      'media-digest-owner-manifest',
      'catalog-pack-map',
      'persona-slot-visibility-map',
      'sort-and-delete-protection',
      'prior-sticker-import-receipts',
    ],
  ],
  [
    'voice_resources',
    'character_voice_bindings user_character_voice_styles',
    ['reconcile-existing', 'retain-reviewed'],
    [...EVIDENCE, 'voice-provider-id-map', 'preserve-existing-voices', 'no-paid-recloning'],
  ],
  [
    'entitlements',
    'membership_orders order_fulfillments payment_notifications membership_intro_grants invite_codes invite_relations invite_rewards',
    ['map-protected', 'retain-reviewed'],
    [
      ...EVIDENCE,
      'payment-order-receipt-chain',
      'prior-fulfillment-dedup',
      'target-wallet-entitlement-preservation',
      'late-payment-plan',
    ],
  ],
  [
    'usage_archive',
    'usage_counters voice_quota_charges group_voice_command_charges realtime_call_usage',
    ['retain-reviewed'],
    ['owner-map', 'recoverable-encrypted-archive', 'usage-is-not-wallet', 'no-recharge-or-replay'],
  ],
  [
    'calls',
    'realtime_call_policies realtime_call_sessions realtime_call_transcript_turns',
    ['map-protected', 'retain-reviewed'],
    [...EVIDENCE, 'call-message-media-map', 'no-call-restart'],
  ],
  [
    'wechat_channel',
    'wechat_bindings wechat_binding_attempts wechat_inbox wechat_deliveries',
    ['rebind-reviewed', 'retain-reviewed'],
    [
      'owner-map',
      'capability-verification',
      'consumer-fence',
      'pending-delivery-dedup',
      'credential-handling',
      'rebind-instructions',
    ],
  ],
  [
    'weibo_channel',
    'weibo_bindings weibo_binding_codes weibo_inbox weibo_deliveries',
    ['rebind-reviewed', 'retain-reviewed'],
    [
      'owner-map',
      'capability-verification',
      'consumer-fence',
      'pending-delivery-dedup',
      'credential-handling',
      'rebind-instructions',
      'multi-slot-resolution',
    ],
  ],
  [
    'qq_channel',
    'qq_bindings qq_binding_codes qq_inbox qq_deliveries',
    ['rebind-reviewed', 'retain-reviewed'],
    [
      'owner-map',
      'capability-verification',
      'consumer-fence',
      'pending-delivery-dedup',
      'credential-handling',
      'rebind-instructions',
    ],
  ],
  [
    'pending_work',
    'chat_reply_jobs chat_reply_effects group_turn_jobs group_turn_reply_slots group_notification_outbox moment_commands moment_interaction_jobs moment_publish_jobs media_send_commands friend_add_commands proactive_messages group_agent_edges group_handoff_logs group_scenes group_scene_steps scheduler_leases',
    ['drain-and-archive'],
    [
      'writer-fence',
      'pending-work-reconciliation',
      'completed-effect-dedup',
      'no-automatic-replay',
      'recoverable-encrypted-archive',
    ],
  ],
  [
    'sessions_devices',
    'admin_sessions agent_api_keys device_bindings web_push_subscriptions auth_login_attempts registration_guard',
    ['invalidate-and-retain'],
    [
      'preserve-new-sessions',
      'no-old-token-import',
      'single-notification-owner',
      'new-device-registration',
      'recoverable-encrypted-archive',
    ],
  ],
  [
    'configuration',
    'system_settings ai_endpoints ai_providers ai_scene_routes assistant_settings assistant_knowledge_entries',
    ['reconcile-keys', 'retain-reviewed'],
    [
      'protected-key-inventory',
      'preserve-new-configuration',
      'reviewed-key-diff',
      'no-environment-or-secret-copy',
    ],
  ],
  [
    'operations_archive',
    'daily_activity_snapshot request_stats request_outcome_stats risk_events ops_action_audit user_feedback public_files support_sessions support_session_feedback official_welcome_receipts official_announcements official_announcement_recipients chat_context_snapshots chat_model_attempts',
    ['retain-reviewed'],
    [
      'owner-or-system-scope',
      'recoverable-encrypted-archive',
      'retention-policy',
      'no-notification-or-fee-replay',
    ],
  ],
  [
    'schema_control',
    'schema_migrations chat_groups_dynamic_migration device_bindings_legacy_0062 chat_reply_jobs__0102 chat_reply_jobs__0106',
    ['exclude-reviewed'],
    ['authoritative-table-inventory', 'ddl-history-review', 'no-legacy-schema-apply'],
  ],
];
const VIRTUAL_RULES = {
  recovery_codes: {
    domain: 'recovery_codes',
    // Product decision 2026-11-09: retire legacy recovery codes; do not import them.
    actions: ['do-not-carry-forward'],
    requires: [
      'confirmed-recovery-retirement-decision',
      'no-recovery-secret-export',
      'preserve-current-account-recovery',
      'password-compatibility-is-separate',
      'no-password-downgrade',
    ],
  },
  local_device: {
    domain: 'local_device',
    // Keeping an unreadable old container does not satisfy required favorites preservation.
    actions: ['preserve-required-favorites'],
    requires: [
      'device-data-inventory',
      'unsent-work-no-replay',
      'local-favorite-export-path',
      'confirmed-favorites-preservation-decision',
      'favorite-owner-source-map',
      'favorite-supported-read-or-import',
      'favorite-original-byte-preservation',
      'favorite-roundtrip-digests',
      'unsynced-edit-handling',
      'preserve-app-container',
      'user-instructions',
    ],
  },
};

function requireValue(value, code) {
  if (!value) throw new Error(code);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function inventoryDigest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function normal(text) {
  return text.replace(/\s+/gu, ' ').trim();
}
function sourceDigest(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function migrationDomainRule(table) {
  if (Object.hasOwn(RETIRED_TABLES, table))
    return {
      domain: RETIRED_TABLES[table].domain,
      actions: ['retain-encrypted-history'],
      requires: [
        ...RETIRED_EVIDENCE,
        ...(table === 'cdks'
          ? ['unused-codes-preserved-without-seed-assumption', 'no-numeric-owner-id-guess']
          : []),
      ],
    };
  const hit = RULES.find(([, tables]) => tables.split(' ').includes(table));
  return hit ? { domain: hit[0], actions: [...hit[2]], requires: [...hit[3]] } : null;
}

// Only scans strings/comments. It never evals, imports, requires or runs legacy JavaScript.
function stringLiterals(source, name) {
  const strings = [];
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  requireValue(file.parseDiagnostics.length === 0, 'LEGACY_SOURCE_PARSE_FAILED');
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      strings.push({ text: node.text });
    else if (ts.isTemplateExpression(node))
      strings.push({
        text:
          node.head.text +
          node.templateSpans.map((span) => '${dynamic}' + span.literal.text).join(''),
      });
    ts.forEachChild(node, visit);
  }
  visit(file);
  return strings;
}

function maskSqlCommentsAndValues(sql) {
  return sql.replace(/'(?:''|[^'])*'|--[^\r\n]*|\/\*[\s\S]*?\*\//gu, (value) =>
    value.replace(/[^\r\n]/gu, ' '),
  );
}

function splitDefinitions(body) {
  const parts = [];
  let depth = 0,
    quote = '',
    start = 0;
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quote) {
      if (char === quote) {
        if (body[index + 1] === quote) index++;
        else quote = '';
      } else if (char === '\\') index++;
    } else if (["'", '"', '`'].includes(char)) quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

function matchingParen(sql, start) {
  let depth = 0,
    quote = '';
  for (let index = start; index < sql.length; index++) {
    const char = sql[index];
    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) index++;
        else quote = '';
      } else if (char === '\\') index++;
    } else if (["'", '"', '`'].includes(char)) quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return index;
  }
  return -1;
}

function collectSql(sql, source, tables, unresolved) {
  const masked = maskSqlCommentsAndValues(sql);
  const create =
    /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z][a-z0-9_]*)\s*\(/giu;
  for (const match of masked.matchAll(create)) {
    const table = match[1].toLowerCase(),
      start = match.index + match[0].length - 1;
    const end = matchingParen(sql, start);
    if (end < 0) {
      unresolved.push({ source, code: 'UNPARSED_TABLE_DDL', table });
      continue;
    }
    const body = sql.slice(start + 1, end);
    if (body.includes('${')) unresolved.push({ source, code: 'DYNAMIC_TABLE_DDL', table });
    const entry = tables.get(table) ?? {
      name: table,
      columns: new Map(),
      constraints: new Set(),
      sources: new Set(),
    };
    entry.sources.add(source);
    for (const definition of splitDefinitions(body)) {
      const column = /^\s*(?:["`]|\[)?([a-z][a-z0-9_]*)(?:["`]|\])?\s+(.+)$/isu.exec(definition);
      if (!column || /^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK)$/iu.test(column[1])) {
        entry.constraints.add(sourceDigest(normal(definition)));
        continue;
      }
      const name = column[1].toLowerCase();
      const variants = entry.columns.get(name) ?? new Set();
      variants.add(sourceDigest(normal(column[2])));
      entry.columns.set(name, variants);
    }
    tables.set(table, entry);
  }
  // Source-only snapshots deliberately remain unresolved: helper-driven ADD/DROP/RENAME
  // and rebuilds cannot establish the final live schema without reviewed schema metadata.
  if (/\b(?:ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE[^;]*\$\{)/iu.test(masked))
    unresolved.push({ source, code: 'MIGRATION_DDL_REQUIRES_FINAL_SCHEMA' });
  const parsedStarts = new Set([...masked.matchAll(create)].map((match) => match.index));
  if (
    [...masked.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE/giu)].some(
      (match) => !parsedStarts.has(match.index),
    )
  )
    unresolved.push({ source, code: 'UNPARSED_CREATE_DDL' });
}

function assembleSchema(tables, sources, unresolved, kind) {
  const records = [...tables.values()]
    .map((table) => {
      const columns = [...table.columns]
        .map(([name, variants]) => ({ name, variants: [...variants].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const constraints = [...table.constraints].sort();
      return {
        name: table.name,
        columns,
        constraints,
        sources: [...table.sources].sort(),
        digest: inventoryDigest({ name: table.name, columns, constraints }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const payload = { kind, tables: records, sources, unresolved };
  return { ...payload, digest: inventoryDigest(payload) };
}

export function schemaFromSources(sources) {
  requireValue(Array.isArray(sources) && sources.length > 0, 'SCHEMA_SOURCES_REQUIRED');
  const tables = new Map(),
    unresolved = [],
    fingerprints = [];
  for (const source of [...sources].sort((a, b) => a.name.localeCompare(b.name))) {
    requireValue(
      typeof source.text === 'string' && typeof source.name === 'string',
      'INVALID_SOURCE_FILE',
    );
    fingerprints.push({ name: source.name, sha256: sourceDigest(source.text) });
    const literals = source.name.endsWith('.sql')
      ? [{ text: source.text }]
      : stringLiterals(source.text, source.name);
    for (const literal of literals) collectSql(literal.text, source.name, tables, unresolved);
  }
  requireValue(tables.size > 0, 'NO_SCHEMA_TABLES_FOUND');
  return assembleSchema(tables, fingerprints, unresolved, 'source-static');
}

export function syntheticSchema(sql) {
  requireValue(typeof sql === 'string' && !sql.includes('${'), 'SYNTHETIC_SCHEMA_SQL_REQUIRED');
  const tables = new Map(),
    unresolved = [];
  collectSql(sql, 'synthetic-schema.sql', tables, unresolved);
  requireValue(tables.size > 0 && unresolved.length === 0, 'SYNTHETIC_CREATE_SCHEMA_ONLY');
  return assembleSchema(
    tables,
    [{ name: 'synthetic-schema.sql', sha256: sourceDigest(sql) }],
    [],
    'synthetic-schema',
  );
}

export function readExportWhitelist(python) {
  requireValue(typeof python === 'string', 'EXPORTER_SOURCE_REQUIRED');
  const block = /\bqueries\s*=\s*\{([\s\S]*?)^\s*\}/mu.exec(python)?.[1];
  requireValue(block, 'EXPORT_QUERY_WHITELIST_REQUIRED');
  const entries = [];
  for (const line of block
    .split(/\r?\n/u)
    .filter((value) => value.trim() && !value.trim().startsWith('#'))) {
    const match =
      /^\s*['"]([a-z][a-z0-9_]*)['"]\s*:\s*['"]SELECT\s+(\*|[a-z0-9_, ]+)\s+FROM\s+([a-z][a-z0-9_]*)(?:\s+ORDER\s+BY\s+[a-z0-9_, ]+)?['"]\s*,?\s*$/iu.exec(
        line,
      );
    requireValue(
      match && match[1] === match[3] && !entries.some((entry) => entry.table === match[1]),
      'UNSUPPORTED_EXPORT_QUERY',
    );
    entries.push({
      table: match[1],
      columns: match[2] === '*' ? '*' : match[2].split(',').map((value) => value.trim()),
    });
  }
  requireValue(entries.length > 0, 'EMPTY_EXPORT_WHITELIST');
  const payload = {
    sourceSha256: sourceDigest(python),
    entries: entries.sort((a, b) => a.table.localeCompare(b.table)),
  };
  return { ...payload, digest: inventoryDigest(payload) };
}

function intactSchema(schema) {
  if (
    !schema ||
    !['source-static', 'synthetic-schema'].includes(schema.kind) ||
    !Array.isArray(schema.tables) ||
    !Array.isArray(schema.unresolved)
  )
    return false;
  const { digest, ...payload } = schema;
  return (
    digest === inventoryDigest(payload) &&
    schema.tables.every(
      (table) =>
        table.digest ===
        inventoryDigest({
          name: table.name,
          columns: table.columns,
          constraints: table.constraints,
        }),
    )
  );
}
function utc(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function isDigest(value) {
  return typeof value === 'string' && HEX.test(value);
}

function retiredTableProblems(table, observation, decision, schema, window, add) {
  // Metadata only. Never accept rows, code values, paths or free-form remarks.
  const fields = new Set([
    'schemaDigest',
    'tableDigest',
    'sourceFinalDigest',
    'observedAt',
    'rowCount',
    'consumerSourceCommit',
    'consumerSourceDigest',
    'consumerScanDigest',
    'businessConsumerCount',
    ...(table.name === 'cdks' ? ['unusedRows', 'usageMarkedRows'] : []),
  ]);
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    add('RETIRED_TABLE_OBSERVATION_REQUIRED', table.name);
    return;
  }
  if (Object.keys(observation).some((key) => !fields.has(key)))
    add('UNEXPECTED_RETIRED_OBSERVATION_FIELD', table.name);
  if (
    observation.schemaDigest !== schema.digest ||
    observation.tableDigest !== table.digest ||
    !isDigest(observation.sourceFinalDigest) ||
    observation.sourceFinalDigest !== window?.sourceFinalDigest ||
    !utc(observation.observedAt) ||
    !utc(window?.from) ||
    !utc(window?.to) ||
    Date.parse(observation.observedAt) < Date.parse(window.from) ||
    Date.parse(observation.observedAt) > Date.parse(window.to)
  )
    add('RETIRED_OBSERVATION_BASELINE_MISMATCH', table.name);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (
    !count(observation.rowCount) ||
    (table.name === 'cdks' &&
      (!count(observation.unusedRows) ||
        !count(observation.usageMarkedRows) ||
        observation.unusedRows + observation.usageMarkedRows !== observation.rowCount))
  )
    add('RETIRED_CURRENT_ROW_COUNTS_REQUIRED', table.name);
  if (
    typeof observation.consumerSourceCommit !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(observation.consumerSourceCommit) ||
    !isDigest(observation.consumerSourceDigest) ||
    !isDigest(observation.consumerScanDigest) ||
    observation.consumerScanDigest !== decision?.proofs?.['no-runtime-business-consumers'] ||
    observation.businessConsumerCount !== 0
  )
    add('RETIRED_NO_BUSINESS_CONSUMERS_PROOF_REQUIRED', table.name);
  if (
    !decision?.retirementReview ||
    Object.keys(decision.retirementReview).some((key) => key !== 'observationDigest') ||
    decision.retirementReview.observationDigest !== inventoryDigest(observation)
  )
    add('RETIRED_REVIEW_OBSERVATION_MISMATCH', table.name);
}

function eventProblems(kind, stream, context, add) {
  if (!stream || !Array.isArray(stream.items)) {
    add('EVENT_LEDGER_REQUIRED', kind);
    return;
  }
  const coverage = stream.coverage;
  if (
    !coverage ||
    coverage.from !== context.window.from ||
    coverage.to !== context.window.to ||
    coverage.schemaDigest !== context.schema.digest ||
    coverage.exporterDigest !== context.exporter.digest ||
    coverage.sourceBaselineDigest !== context.window.sourceBaselineDigest ||
    coverage.sourceFinalDigest !== context.window.sourceFinalDigest ||
    coverage.targetBaselineDigest !== context.window.targetBaselineDigest ||
    !isDigest(coverage.scanManifestDigest)
  )
    add('EVENT_COVERAGE_MISMATCH', kind);
  if (stream.itemsDigest !== inventoryDigest(stream.items))
    add('EVENT_LEDGER_DIGEST_MISMATCH', kind);
  if (
    coverage?.expectedEventSetDigest !==
    inventoryDigest(stream.items.map((event) => event?.eventKey).sort())
  )
    add('EVENT_SET_INCOMPLETE', kind);
  if (stream.items.length === 0 && !isDigest(stream.emptyScanProofDigest))
    add('EMPTY_EVENT_SCAN_PROOF_REQUIRED', kind);
  const ids = new Set(),
    orderIds = new Set();
  const fields = {
    deletions: [
      'sourceObjectKey',
      'mappingProofDigest',
      'targetBarrierDigest',
      'relatedTargetKeys',
      'relatedTargetSetDigest',
      'expectedTargetSetDigest',
      'decisionDigest',
    ],
    passwords: [
      'baselineCredentialFingerprint',
      'sourceCredentialFingerprint',
      'targetCredentialFingerprint',
      'comparisonProofDigest',
      'targetScheme',
      'resultScheme',
      'targetAbsenceProofDigest',
      'sourceChangeEventDigest',
      'decisionDigest',
    ],
    entitlements: [
      'sourceOrderKey',
      'paymentReceiptDigest',
      'priorImportReceiptDigest',
      'targetLedgerReceiptDigest',
      'deduplicationKey',
      'paymentStatus',
      'refundStatus',
      'approvedDeltaDigest',
      'decisionDigest',
    ],
  };
  const allowedFields = new Set(['eventKey', 'ownerKey', 'occurredAt', 'action', ...fields[kind]]);
  for (const event of stream.items) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      add('INVALID_EVENT_METADATA', kind);
      continue;
    }
    if (Object.keys(event).some((key) => !allowedFields.has(key)))
      add('UNEXPECTED_EVENT_FIELD', kind);
    if (!isDigest(event.eventKey) || !isDigest(event.ownerKey) || ids.has(event.eventKey)) {
      add('INVALID_OR_DUPLICATE_EVENT_ID', kind);
      continue;
    }
    ids.add(event.eventKey);
    if (
      !utc(event.occurredAt) ||
      Date.parse(event.occurredAt) <= Date.parse(context.window.from) ||
      Date.parse(event.occurredAt) > Date.parse(context.window.to)
    )
      add('EVENT_OUTSIDE_WINDOW', kind);
    if (kind === 'deletions') {
      if (
        !['skip-deleted-source', 'preserve-target-barrier', 'approved-hide'].includes(
          event.action,
        ) ||
        !isDigest(event.sourceObjectKey) ||
        !isDigest(event.mappingProofDigest) ||
        !isDigest(event.targetBarrierDigest) ||
        !Array.isArray(event.relatedTargetKeys) ||
        !event.relatedTargetKeys.every(isDigest) ||
        new Set(event.relatedTargetKeys).size !== event.relatedTargetKeys.length ||
        event.relatedTargetSetDigest !== inventoryDigest([...event.relatedTargetKeys].sort()) ||
        event.expectedTargetSetDigest !== event.relatedTargetSetDigest
      )
        add('DELETION_IMPACT_EVIDENCE_REQUIRED', kind);
      if (
        event.action === 'approved-hide' &&
        (!event.relatedTargetKeys?.length || !isDigest(event.decisionDigest))
      )
        add('DELETION_EXPLICIT_DECISION_REQUIRED', kind);
    } else if (kind === 'passwords') {
      if (
        !['preserve-target', 'import-new-account', 'reviewed-source-change'].includes(
          event.action,
        ) ||
        !isDigest(event.sourceCredentialFingerprint) ||
        !isDigest(event.comparisonProofDigest)
      )
        add('PASSWORD_CHANGE_EVIDENCE_REQUIRED', kind);
      if (event.action === 'import-new-account') {
        if (event.targetCredentialFingerprint !== null || !isDigest(event.targetAbsenceProofDigest))
          add('NEW_ACCOUNT_ABSENCE_EVIDENCE_REQUIRED', kind);
      } else {
        if (!['argon2id', 'bcrypt'].includes(event.targetScheme))
          add('PASSWORD_TARGET_SCHEME_REQUIRED', kind);
        if (
          !isDigest(event.baselineCredentialFingerprint) ||
          !isDigest(event.targetCredentialFingerprint)
        )
          add('PASSWORD_BASELINE_REQUIRED', kind);
        if (
          event.targetCredentialFingerprint !== event.baselineCredentialFingerprint &&
          event.action !== 'preserve-target'
        )
          add('NEW_PASSWORD_MUST_BE_PRESERVED', kind);
      }
      if (
        event.action === 'reviewed-source-change' &&
        (!isDigest(event.sourceChangeEventDigest) || !isDigest(event.decisionDigest))
      )
        add('PASSWORD_SOURCE_CHANGE_EVENT_REQUIRED', kind);
      if (event.targetScheme === 'argon2id' && event.resultScheme !== 'argon2id')
        add('PASSWORD_ALGORITHM_DOWNGRADE_FORBIDDEN', kind);
      if (!['argon2id', 'bcrypt'].includes(event.resultScheme))
        add('PASSWORD_RESULT_SCHEME_REQUIRED', kind);
    } else {
      if (event.action === 'apply-reviewed-uncredited') {
        if (orderIds.has(event.sourceOrderKey)) add('DUPLICATE_ENTITLEMENT_ORDER', kind);
        orderIds.add(event.sourceOrderKey);
      }
      if (
        !['retain-target', 'already-accounted', 'apply-reviewed-uncredited'].includes(
          event.action,
        ) ||
        !isDigest(event.sourceOrderKey) ||
        !isDigest(event.paymentReceiptDigest) ||
        !isDigest(event.priorImportReceiptDigest) ||
        !isDigest(event.targetLedgerReceiptDigest) ||
        event.deduplicationKey !== inventoryDigest(['legacy-entitlement', event.eventKey])
      )
        add('ENTITLEMENT_EVENT_CHAIN_REQUIRED', kind);
      if (
        event.action === 'apply-reviewed-uncredited' &&
        (event.paymentStatus !== 'settled' ||
          event.refundStatus !== 'none' ||
          !isDigest(event.approvedDeltaDigest) ||
          !isDigest(event.decisionDigest))
      )
        add('UNCREDITED_ENTITLEMENT_DECISION_REQUIRED', kind);
    }
  }
}

/** Returns an actionable block list; even a complete synthetic plan never authorizes production. */
export function planMigrationInventory({
  schema,
  previousSchema,
  exporter,
  window,
  decisions = {},
  events = {},
  retiredTableObservations = {},
}) {
  requireValue(intactSchema(schema), 'INVALID_SCHEMA_DIGEST');
  const { digest: exporterDigest, ...exportPayload } = exporter ?? {};
  requireValue(exporterDigest === inventoryDigest(exportPayload), 'INVALID_EXPORTER_DIGEST');
  const blockers = [],
    rows = [];
  const add = (code, scope, detail) =>
    blockers.push({ code, scope, ...(detail ? { detail } : {}) });
  if (schema.kind !== 'synthetic-schema') add('SOURCE_SCHEMA_NOT_RUNTIME_VERIFIED', 'schema');
  for (const item of schema.unresolved) add(item.code, 'schema', item.source);
  const baseline = intactSchema(previousSchema) ? previousSchema : null;
  if (!baseline) add('BASELINE_SCHEMA_REQUIRED', 'schema');
  const validWindow =
    window &&
    utc(window.from) &&
    utc(window.to) &&
    Date.parse(window.from) < Date.parse(window.to) &&
    ['sourceBaselineDigest', 'sourceFinalDigest', 'targetBaselineDigest'].every((key) =>
      isDigest(window[key]),
    );
  if (!validWindow) add('MIGRATION_WINDOW_BASELINES_REQUIRED', 'events');
  const before = new Map((baseline?.tables ?? []).map((table) => [table.name, table]));
  const current = new Set(schema.tables.map((table) => table.name));
  const exported = new Map(exporter.entries.map((entry) => [entry.table, entry.columns]));
  for (const table of baseline?.tables ?? [])
    if (!current.has(table.name)) add('SCHEMA_TABLE_REMOVED', table.name);
  for (const entry of exporter.entries)
    if (!current.has(entry.table)) add('EXPORTED_TABLE_MISSING', entry.table);

  const decide = (table, rule, omittedColumns, virtual = false) => {
    const decision = decisions[table.name];
    const retired = Object.hasOwn(RETIRED_TABLES, table.name);
    const required = [...rule.requires];
    const row = {
      table: table.name,
      schemaDigest: table.digest,
      domain: rule.domain,
      exportCovered: virtual ? false : exported.has(table.name),
      omittedColumns,
      allowedActions: rule.actions,
      requiredEvidence: required,
      selectedAction: rule.actions.includes(decision?.action) ? decision.action : null,
      ...(retired
        ? {
            sensitiveColumns: [...RETIRED_TABLES[table.name].sensitiveColumns],
            prohibitedOperations: [...RETIRED_PROHIBITIONS],
          }
        : {}),
      status: 'blocked',
    };
    const initial = blockers.length;
    if (retired)
      retiredTableProblems(
        table,
        retiredTableObservations?.[table.name],
        decision,
        schema,
        window,
        add,
      );
    if (!decision)
      add(
        virtual
          ? 'DOMAIN_DISPOSITION_REQUIRED'
          : exported.has(table.name)
            ? 'TABLE_MAPPING_REQUIRED'
            : 'UNCOVERED_TABLE_DISPOSITION_REQUIRED',
        table.name,
      );
    else {
      if (!rule.actions.includes(decision.action)) add('DISPOSITION_NOT_ALLOWED', table.name);
      if (
        decision.schemaDigest !== schema.digest ||
        decision.tableDigest !== table.digest ||
        decision.exporterDigest !== exporter.digest
      )
        add('DISPOSITION_BASELINE_MISMATCH', table.name);
      for (const key of required)
        if (!isDigest(decision.proofs?.[key])) add('DOMAIN_EVIDENCE_REQUIRED', table.name, key);
      if (
        [
          'retain-reviewed',
          'rebind-reviewed',
          'exclude-reviewed',
          'retain-encrypted-history',
        ].includes(decision.action) &&
        (!isDigest(decision.productDecisionDigest) ||
          !isDigest(decision.proofs?.['user-or-operator-instructions']))
      )
        add('REVIEWED_DISPOSITION_DECISION_REQUIRED', table.name);
      if (
        decision.action === 'rebind-reviewed' &&
        (decision.capabilityStatus !== 'enabled-and-verified' ||
          !isDigest(decision.capabilityEvidenceDigest))
      )
        add('REBIND_CAPABILITY_NOT_VERIFIED', table.name);
      for (const column of table.columns) {
        const mapping = decision.columns?.[column.name];
        if (
          !mapping ||
          !['map', 'protect-target', 'retain-encrypted', 'exclude-reviewed'].includes(
            mapping.action,
          ) ||
          !isDigest(mapping.proofDigest)
        ) {
          add('COLUMN_DISPOSITION_REQUIRED', table.name, column.name);
          continue;
        }
        if (
          mapping.action === 'map' &&
          (typeof mapping.target !== 'string' || !/^[a-z][a-z0-9_.]+$/u.test(mapping.target))
        )
          add('COLUMN_TARGET_REQUIRED', table.name, column.name);
        if (
          (/(?:password|recovery_code|token|secret|cookie)/u.test(column.name) ||
            (retired && RETIRED_TABLES[table.name].sensitiveColumns.includes(column.name))) &&
          mapping.action === 'map'
        )
          add('SENSITIVE_FIELD_DIRECT_COPY_FORBIDDEN', table.name, column.name);
        if (retired && (mapping.action !== 'retain-encrypted' || mapping.target !== undefined))
          add('RETIRED_FIELD_ENCRYPTED_RETENTION_REQUIRED', table.name, column.name);
        if (column.name === 'recovery_code_hash' && mapping.action !== 'exclude-reviewed')
          add('RECOVERY_CODE_RETIREMENT_REQUIRED', table.name, column.name);
        if (mapping.action === 'exclude-reviewed' && !isDigest(mapping.decisionDigest))
          add('COLUMN_EXCLUSION_DECISION_REQUIRED', table.name, column.name);
      }
    }
    row.status = blockers.length === initial ? 'planned' : 'blocked';
    rows.push(row);
  };

  for (const table of schema.tables) {
    requireValue(NAME.test(table.name), 'INVALID_TABLE_IDENTIFIER');
    const prior = before.get(table.name);
    if (baseline && !prior) add('SCHEMA_TABLE_ADDED', table.name);
    else if (prior && prior.digest !== table.digest) {
      const oldColumns = new Map(
        prior.columns.map((column) => [column.name, inventoryDigest(column)]),
      );
      for (const column of table.columns)
        if (oldColumns.get(column.name) !== inventoryDigest(column))
          add(
            oldColumns.has(column.name) ? 'SCHEMA_COLUMN_CHANGED' : 'SCHEMA_COLUMN_ADDED',
            table.name,
            column.name,
          );
      for (const column of prior.columns)
        if (!table.columns.some((next) => next.name === column.name))
          add('SCHEMA_COLUMN_REMOVED', table.name, column.name);
      if (inventoryDigest(prior.constraints) !== inventoryDigest(table.constraints))
        add('SCHEMA_CONSTRAINT_CHANGED', table.name);
    }
    const rule = migrationDomainRule(table.name);
    if (!rule) {
      add('UNCLASSIFIED_TABLE', table.name);
      rows.push({
        table: table.name,
        domain: null,
        exportCovered: exported.has(table.name),
        status: 'blocked',
      });
      continue;
    }
    const projection = exported.get(table.name);
    if (Object.hasOwn(RETIRED_TABLES, table.name) && projection) {
      add('RETIRED_TABLE_ORDINARY_EXPORT_FORBIDDEN', table.name);
      for (const column of RETIRED_TABLES[table.name].sensitiveColumns)
        if (projection === '*' || projection.includes(column))
          add('SENSITIVE_RETIRED_FIELD_EXPORTED', table.name, column);
    }
    if (
      table.columns.some((column) => column.name === 'recovery_code_hash') &&
      (projection === '*' || projection?.includes('recovery_code_hash'))
    )
      add('RETIRED_RECOVERY_FIELD_EXPORTED', table.name, 'recovery_code_hash');
    if (projection && projection !== '*')
      for (const column of projection)
        if (!table.columns.some((field) => field.name === column))
          add('EXPORTED_COLUMN_MISSING', table.name, column);
    const omitted = table.columns
      .filter((column) => projection !== '*' && !projection?.includes(column.name))
      .map((column) => column.name);
    decide(table, rule, omitted);
  }
  const virtuals = ['local_device'];
  if (
    schema.tables.some(
      (table) =>
        table.name === 'app_users' &&
        table.columns.some((column) => column.name === 'recovery_code_hash'),
    )
  )
    virtuals.push('recovery_codes');
  for (const key of virtuals) {
    const table = {
      name: `@${key}`,
      columns: [],
      digest: inventoryDigest({ virtual: key, schema: schema.digest }),
    };
    decide(table, VIRTUAL_RULES[key], [], true);
  }
  if (validWindow) {
    const context = { schema, exporter, window };
    eventProblems('deletions', events.deletions, context, add);
    if (schema.tables.some((table) => ['app_users', 'users'].includes(table.name)))
      eventProblems('passwords', events.passwords, context, add);
    if (
      schema.tables.some(
        (table) =>
          migrationDomainRule(table.name)?.domain === 'entitlements' || table.name === 'app_users',
      )
    )
      eventProblems('entitlements', events.entitlements, context, add);
  }
  const unique = [...new Map(blockers.map((item) => [JSON.stringify(item), item])).values()];
  for (const row of rows)
    if (unique.some((blocker) => blocker.scope === row.table)) row.status = 'blocked';
  const payload = {
    policy: 'legacy-delta-inventory-v1',
    productionReady: false,
    mode: schema.kind,
    status: unique.length ? 'blocked' : 'planned-for-synthetic-rehearsal',
    schemaDigest: schema.digest,
    exporterDigest: exporter.digest,
    inventory: rows,
    blockers: unique,
    summary: {
      tables: schema.tables.length,
      exportedTables: rows.filter((row) => row.exportCovered).length,
      notInExporter: rows.filter((row) => !row.table.startsWith('@') && !row.exportCovered).length,
      virtualDomains: virtuals.length,
      blockedReasons: unique.length,
    },
    limitations: [
      'Schema declarations are not a live database inventory',
      'Evidence digests bind a plan to supplied artifacts; they do not verify their truth',
      'No private records, credentials, database access, writes or production execution',
    ],
  };
  return { ...payload, digest: inventoryDigest(payload) };
}

export async function inspectLegacySchemaSources(root) {
  requireValue(
    typeof root === 'string' && !/^(?:\\\\|\/\/)/u.test(root),
    'LOCAL_SOURCE_ROOT_REQUIRED',
  );
  const sourceRoot = await realpath(resolve(root));
  const server = join(sourceRoot, 'server');
  const sources = [];
  const excluded = new Set([
    'node_modules',
    'tests',
    'public',
    'data',
    'backups',
    'backup',
    'exports',
    'logs',
    'generated',
    '.git',
  ]);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      const path = join(directory, entry.name),
        stat = await lstat(path);
      requireValue(
        !stat.isSymbolicLink() && (await realpath(path)).startsWith(sourceRoot + sep),
        'SOURCE_PATH_ESCAPES_ROOT',
      );
      if (stat.isDirectory()) await walk(path);
      else if (['.js', '.sql'].includes(extname(entry.name))) {
        const text = await readFile(path, 'utf8');
        if (/\b(?:CREATE|ALTER|DROP)\s+TABLE/iu.test(text))
          sources.push({ name: relative(sourceRoot, path).split(sep).join('/'), text });
      }
    }
  }
  await walk(server);
  return schemaFromSources(sources);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith('--'))
    throw new Error(
      'Usage: node scripts/ops/legacy-delta-inventory.mjs <local-legacy-source-root> (no database input accepted)',
    );
  const schema = await inspectLegacySchemaSources(args[0]);
  const exporter = readExportWhitelist(
    await readFile(
      join(dirname(fileURLToPath(import.meta.url)), 'export-legacy-content.py'),
      'utf8',
    ),
  );
  const plan = planMigrationInventory({ schema, exporter });
  console.log(JSON.stringify(plan, null, 2));
  process.exitCode = plan.status === 'blocked' ? 2 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'INVENTORY_FAILED');
    process.exitCode = 1;
  });
