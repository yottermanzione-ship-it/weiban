/** Target maintenance runner. Private gzip input stays in memory; stdout contains only summary counts. */
import '../../apps/server/node_modules/reflect-metadata/Reflect.js';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { fstatSync, readFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { AuditLog } from '../../apps/server/src/platform/audit/audit-log.ts';
import { SettingsService } from '../../apps/server/src/modules/identity/application/settings.ts';
import { MessageContent } from '../../packages/contracts/src/http/chat.ts';
import { UpdateProfileRequest } from '../../packages/contracts/src/http/identity.ts';
import { legacyId, legacyMessageContents } from './legacy-content-rules.mjs';
import {
  fingerprint,
  invariant,
  utc,
  prepareFastChatRows,
  planFastConversation,
} from './fast-cutover-core.mjs';
import { isMigrationOwnerPreserved, assertMigrationOwnersAllowed } from './fast-cutover-owners.mjs';
import { inspectFastTarget } from './fast-cutover-execution.mjs';
import { planFastAccounts, applyFastAccounts } from './fast-cutover-accounts.mjs';
import {
  readLegacyRelationsBaseline,
  planFastRelations,
  applyFastRelations,
} from './fast-cutover-relations.mjs';
import { readConversationBaseline, applyFastConversation } from './fast-cutover-chat-db.mjs';
import { planFastDeletions, applyFastDeletions } from './fast-cutover-deletions.mjs';
import { mapFastSource, fastRelationProtection } from './fast-cutover-source.mjs';
import {
  applyMigrationBenefits,
  calculateMigrationCompensation,
} from './migration-benefits-20261109.mjs';

const INITIAL = '2026-10-24T12:02:47.053609Z';
const TABLES = new Set([
  'app_users',
  'user_friends',
  'chat_groups',
  'chat_group_members',
  'chat_history',
  'group_messages',
  'chat_read_cursors',
  '_media',
]);
const safeCode = (error) =>
  /^[A-Z][A-Z0-9_]{2,100}$/u.test(error?.message ?? '') ? error.message : 'FAST_CUTOVER_FAILED';
export async function readFastSnapshot(input) {
  const gzip = createGunzip(),
    tables = new Map();
  let bytes = 0,
    snapshot = null,
    complete = null;
  const lines = createInterface({ input: gzip, crlfDelay: Infinity });
  const failed = new Promise((_, reject) => {
    gzip.once('error', () => {
      lines.close();
      reject(new Error('FAST_SOURCE_GZIP_INVALID'));
    });
    input.once('error', () => {
      gzip.destroy();
      lines.close();
      reject(new Error('FAST_SOURCE_STREAM_FAILED'));
    });
  });
  input.pipe(gzip);
  gzip.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 512 * 1024 * 1024) gzip.destroy(new Error('FAST_SOURCE_SIZE_LIMIT'));
  });
  await Promise.race([
    failed,
    (async () => {
      for await (const line of lines) {
        if (!line) continue;
        const value = JSON.parse(line);
        invariant(
          value && value.row && typeof value.row === 'object' && !complete,
          'FAST_SOURCE_FRAME_INVALID',
        );
        if (value.table === '_snapshot') {
          invariant(
            !snapshot && value.row.version === 1 && value.row.format === 'fast-cutover-20261109',
            'FAST_SOURCE_HEADER_INVALID',
          );
          snapshot = value.row;
          continue;
        }
        if (value.table === '_complete') {
          complete = value.row;
          continue;
        }
        invariant(snapshot && TABLES.has(value.table), 'FAST_SOURCE_TABLE_INVALID');
        const rows = tables.get(value.table) ?? [];
        rows.push(value.row);
        tables.set(value.table, rows);
      }
    })(),
  ]);
  invariant(
    snapshot &&
      complete &&
      complete.freezeId === snapshot.freezeId &&
      complete.sourceFrozen === snapshot.sourceFrozen,
    'FAST_SOURCE_INCOMPLETE',
  );
  for (const [table, count] of Object.entries(complete.counts))
    invariant((tables.get(table)?.length ?? 0) === count, 'FAST_SOURCE_COUNT_MISMATCH');
  // Operational capture/freeze observation time is not source data. Re-exporting unchanged
  // frozen rows at the same cutoff must keep the same reviewed digest, including across retries.
  const hash = createHash('sha256');
  hash.update(
    fingerprint({
      version: snapshot.version,
      format: snapshot.format,
      initialCutoff: utc(snapshot.initialCutoff),
      cutoff: utc(snapshot.cutoff),
    }),
  );
  for (const table of [...TABLES].sort()) {
    hash.update(table + '\n');
    for (const rowDigest of (tables.get(table) ?? []).map(fingerprint).sort())
      hash.update(rowDigest + '\n');
  }
  return { snapshot, tables, sourceDigest: hash.digest('hex') };
}

async function assertTargetStopped(database) {
  const row = (
    await database.query(
      "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND application_name<>'fast-cutover-20261109' ",
    )
  ).rows[0];
  invariant(row.n === 0, 'FAST_TARGET_OTHER_CLIENTS_ACTIVE');
}
const sourceExpiry = (row) => (row?.membership_expire_at ? utc(row.membership_expire_at) : null);

async function prepareMedia(database, messageSources, bindings, pointers) {
  const pointerByRef = new Map(pointers.map((row) => [row.source, row])),
    objects = new Map(),
    choices = new Map(),
    unavailable = new Map();
  let unresolved = 0;
  for (const source of messageSources) {
    const binding = bindings.get(source.sourceKey);
    if (!binding || !['image', 'voice', 'sticker'].includes(source.row.message_type)) continue;
    const row = source.row,
      owner = binding.ownerUserId,
      type = row.message_type,
      refs = [row.media_path, row.audio_url, row.image_url]
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim());
    const key = `${source.table}:${row.id}`;
    if (!refs.length) {
      unavailable.set(key, 'no_reference');
      continue;
    }
    const purpose =
      type === 'voice'
        ? (row.role ?? row.sender_type) === 'user'
          ? 'chat_voice'
          : 'generated_voice'
        : type === 'sticker'
          ? 'user_sticker'
          : 'chat_image';
    const candidates = refs
      .map((ref) => pointerByRef.get(ref))
      .filter(Boolean)
      .filter((info) => info.path)
      .map((info) => ({
        id: legacyId('media', owner, purpose, info.path),
        ownerUserId: owner,
        purpose,
        asset: { ...info, kind: info.status === 'external' ? 'url' : 'file' },
        stickerId:
          purpose === 'user_sticker'
            ? legacyId('user-sticker', owner, legacyId('media', owner, purpose, info.path))
            : null,
        durationMs: row.audio_duration
          ? Math.min(300000, Math.max(1, Math.round(Number(row.audio_duration) * 1000)))
          : null,
      }));
    const found = candidates.length
      ? (
          await database.query(
            'SELECT id,owner_id,purpose,state,expires_at FROM media.objects WHERE id=ANY($1::uuid[])',
            [candidates.map((item) => item.id)],
          )
        ).rows
      : [];
    for (const item of found)
      invariant(
        item.owner_id === owner && item.purpose === purpose,
        'FAST_MEDIA_EXISTING_OWNER_CONFLICT',
      );
    const ready = found.find(
      (item) =>
        item.state === 'ready' && (!item.expires_at || new Date(item.expires_at) > new Date()),
    );
    let chosen = ready
      ? candidates.find((item) => item.id === ready.id)
      : candidates.find((item) => item.asset.status === 'file' || item.asset.status === 'external');
    if (chosen) {
      objects.set(chosen.id, chosen);
      choices.set(key, { object: chosen, ready: !!ready });
      continue;
    }
    if (found.length) {
      unresolved++;
      continue;
    }
    if (refs.every((ref) => pointerByRef.get(ref)?.status === 'missing_file'))
      unavailable.set(key, 'missing_file');
    else unresolved++;
  }
  return { objects: [...objects.values()], choices, unavailable, unresolved };
}

export async function collectFastDeletionFragments(database, tables, cutoff) {
  const groups = new Map((tables.get('chat_groups') ?? []).map((row) => [String(row.id), row]));
  const fragments = [];
  let missingFirst = 0,
    unknownScope = 0,
    candidates = 0,
    excluded = 0;
  for (const table of ['chat_history', 'group_messages'])
    for (const row of tables.get(table) ?? []) {
      if (
        !String(row.deleted_at ?? '').trim() ||
        utc(row.created_at) > utc(INITIAL) ||
        utc(row.deleted_at) <= utc(INITIAL) ||
        utc(row.deleted_at) > utc(cutoff)
      )
        continue;
      const owner =
        table === 'chat_history' ? row.user_id : groups.get(String(row.group_id))?.user_id;
      invariant(owner, 'FAST_DELETION_OWNER_REQUIRED');
      if (isMigrationOwnerPreserved(owner)) {
        excluded++;
        continue;
      }
      if (!['message', 'conversation'].includes(row.deletion_scope)) {
        unknownScope++;
        continue;
      }
      const sourceId = String(row.id),
        firstId = legacyId('message', table, sourceId, 0);
      const first = (
        await database.query(
          'SELECT m.id,m.conversation_id,c.owner_user_id,c.last_seq FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE m.id=$1',
          [firstId],
        )
      ).rows[0];
      if (!first) {
        missingFirst++;
        continue;
      }
      assertMigrationOwnersAllowed([first.owner_user_id]);
      invariant(first.owner_user_id === owner, 'FAST_DELETION_OWNER_CONFLICT');
      const bound = ['image', 'voice', 'sticker'].includes(row.message_type)
        ? Number(first.last_seq)
        : legacyMessageContents(row, null).length;
      invariant(Number.isSafeInteger(bound) && bound > 0, 'FAST_DELETION_BOUND_INVALID');
      candidates += bound;
      invariant(candidates <= 2_000_000, 'FAST_DELETION_SCOPE_BUDGET');
      for (let start = 0; start < bound; start += 2000) {
        const selected = Array.from({ length: Math.min(2000, bound - start) }, (_, offset) => ({
          part: start + offset,
          id: legacyId('message', table, sourceId, start + offset),
        }));
        const parts = new Map(selected.map((item) => [item.id, item.part]));
        const found = (
          await database.query(
            'SELECT m.id,m.client_msg_id,m.conversation_id,m.seq,m.status,c.owner_user_id FROM chat.messages m JOIN chat.conversations c ON c.id=m.conversation_id WHERE m.id=ANY($1::uuid[])',
            [selected.map((item) => item.id)],
          )
        ).rows;
        for (const target of found) {
          const part = parts.get(target.id);
          assertMigrationOwnersAllowed([target.owner_user_id]);
          invariant(
            target.owner_user_id === owner &&
              target.conversation_id === first.conversation_id &&
              target.client_msg_id === legacyId('client-message', table, sourceId, part),
            'FAST_DELETION_IDENTITY_CONFLICT',
          );
          fragments.push({
            table,
            sourceId,
            part,
            messageId: target.id,
            clientId: target.client_msg_id,
            ownerId: owner,
            conversationId: target.conversation_id,
            seq: Number(target.seq),
            status: target.status,
            sourceCreatedAt: row.created_at,
            sourceDeletedAt: row.deleted_at,
            sourceRowDigest: fingerprint(row),
            actorScope: row.deletion_scope === 'message' ? 'user-message' : 'user-clear',
            fullSourceScope: true,
          });
        }
      }
    }
  return { fragments, missingFirst, unknownScope, excluded };
}

/** No transport is built into the runner. importMedia may be supplied by the protected SSH-memory orchestrator. */
export async function runFastCutover({
  snapshot,
  tables,
  sourceDigest,
  database,
  crypto,
  createDefaults,
  validateContent = (content) => MessageContent.parse(content),
  execute = false,
  expectedDatabase,
  expectedOid,
  expectedSourceDigest,
  confirmMaintenance,
  operatorId,
  rounding = 'ceil',
  benefitCutoverAt,
  importMedia,
  onMediaRequired,
  verifyReadyMedia,
  onProgress = () => {},
}) {
  const summary = { mode: execute ? 'execute' : 'plan', sourceDigest, counts: {}, deferred: {} };
  const progress = (phase) =>
    onProgress({ phase, counts: { ...summary.counts }, deferred: { ...summary.deferred } });
  if (expectedSourceDigest)
    invariant(sourceDigest === expectedSourceDigest, 'FAST_SOURCE_DIGEST_MISMATCH');
  const identity = await inspectFastTarget(database);
  if (execute) {
    invariant(
      snapshot.sourceFrozen === true &&
        snapshot.freezeId &&
        confirmMaintenance === snapshot.freezeId,
      'FAST_FROZEN_SOURCE_REQUIRED',
    );
    invariant(
      [
        'loaded-systemd-units-stopped',
        'operator-confirmed-process-stop',
        'loaded-systemd-units-and-operator-process-stop',
      ].includes(snapshot.freezeCheck),
      'FAST_FREEZE_KIND_INVALID',
    );
    invariant(
      identity.name === expectedDatabase && identity.oid === String(expectedOid),
      'FAST_TARGET_IDENTITY_MISMATCH',
    );
    invariant(rounding === 'ceil' && benefitCutoverAt, 'FAST_BENEFIT_POLICY_REQUIRED');
    invariant(
      (
        await database.query(
          "SELECT id FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
          [operatorId],
        )
      ).rows.length === 1,
      'FAST_ACTIVE_OPERATOR_REQUIRED',
    );
    await assertTargetStopped(database);
  }
  const execFor = (plan) => ({
    action: 'APPLY_FAST_CUTOVER_20261109',
    connectionString: database.pool.options.connectionString,
    databaseName: identity.name,
    databaseOid: identity.oid,
    sourceDigest,
    planDigest: plan.digest,
  });
  const sourceUsers = (tables.get('app_users') ?? []).filter(
    (row) => !isMigrationOwnerPreserved(row.id),
  );
  // Validate every old entitlement before any write, even when the later financial phase is last.
  for (const row of sourceUsers.filter((row) => row.status === 'active'))
    calculateMigrationCompensation({
      legacyTier: row.membership_level ?? null,
      legacyExpiresAt: sourceExpiry(row),
      cutoverAt: benefitCutoverAt ?? snapshot.cutoff,
      rounding,
    });
  const existing = (
    await database.query('SELECT id,username,status,role,password_hash FROM identity.users')
  ).rows;
  const targetPasswords = new Map(existing.map((row) => [row.id, row.password_hash]));
  const passwordAlgorithm = (value) =>
    /^\$2[aby]\$/u.test(value ?? '')
      ? 'bcrypt'
      : /^\$argon2id\$/u.test(value ?? '')
        ? 'argon2id'
        : 'other';
  summary.counts.existingPasswordSame = 0;
  summary.counts.existingPasswordDifferent = 0;
  summary.counts.existingPasswordDifferentAlgorithm = 0;
  summary.counts.existingPasswordDifferentSameAlgorithm = 0;
  for (const row of sourceUsers)
    if (targetPasswords.has(row.id)) {
      const current = targetPasswords.get(row.id);
      if (current === row.password_hash) summary.counts.existingPasswordSame++;
      else {
        summary.counts.existingPasswordDifferent++;
        summary.counts[
          passwordAlgorithm(current) === passwordAlgorithm(row.password_hash)
            ? 'existingPasswordDifferentSameAlgorithm'
            : 'existingPasswordDifferentAlgorithm'
        ]++;
      }
    }
  targetPasswords.clear();
  const sourceAccounts = sourceUsers
    .filter((row) => row.status === 'active')
    .map((row) => ({
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
      status: 'active',
      role: 'user',
      timeZone: 'Asia/Shanghai',
    }));
  const accountPlan = planFastAccounts({
    source: sourceAccounts,
    existing,
    sourceDigest,
    cutoff: snapshot.cutoff,
  });
  summary.counts.accountsNew = accountPlan.insert.length;
  summary.counts.accountsKept = accountPlan.kept;
  summary.counts.accountsBlocked = accountPlan.blocked.length;
  invariant(!accountPlan.blocked.length, 'FAST_ACCOUNT_REVIEW_REQUIRED');
  if (execute) {
    await applyFastAccounts({
      database,
      plan: accountPlan,
      source: sourceAccounts,
      createDefaults,
      execution: execFor(accountPlan),
      execute: true,
    });
    progress('accounts');
  }
  const characters = (
    await database.query(
      'SELECT id,name,kind,owner_id,status,is_trial,legacy_card FROM characters.characters',
    )
  ).rows;
  const mapped = mapFastSource({
    tables,
    characters,
    existingUsers: existing,
    cutoff: snapshot.cutoff,
  });
  summary.deferred.unmappedRelations = mapped.unmapped.relations;
  summary.deferred.unmappedMessages = mapped.unmapped.messages;
  let sourceRelations = mapped.sourceRelations;
  let relationBaseline = await readLegacyRelationsBaseline({ database, sourceRelations });
  if (!execute)
    for (const item of accountPlan.insert)
      if (!relationBaseline.users.some((user) => user.id === item.id))
        relationBaseline.users.push({ id: item.id, status: 'active' });
  const relationFailures = {};
  let relationPlan;
  for (let pass = 0; pass < 3; pass++) {
    relationPlan = planFastRelations({
      sourceDigest,
      sourceRelations,
      targetBaseline: relationBaseline,
      protection: fastRelationProtection(sourceRelations, relationBaseline),
      capturedAt: snapshot.cutoff,
    });
    if (!relationPlan.conflicts.length) break;
    const blocked = new Set(relationPlan.conflicts.map((item) => item.sourceKey));
    for (const item of relationPlan.conflicts)
      relationFailures[item.reason] = (relationFailures[item.reason] ?? 0) + 1;
    sourceRelations = sourceRelations.filter((item) => !blocked.has(item.sourceKey));
  }
  invariant(!relationPlan.conflicts.length, 'FAST_RELATION_REVIEW_REQUIRED');
  summary.deferred.relationCategories = relationFailures;
  summary.deferred.relationClassifications = relationPlan.summary.classifications;
  summary.counts.relationsInserted = relationPlan.insert.conversations.length;
  summary.counts.contactsInserted = relationPlan.insert.contacts.length;
  if (execute) {
    await assertTargetStopped(database);
    await applyFastRelations({
      database,
      plan: relationPlan,
      sourceDigest,
      execution: execFor(relationPlan),
      execute: true,
    });
    progress('relations');
  }
  const bindings = new Map(relationPlan.bindings.map((binding) => [binding.sourceKey, binding]));
  const media = await prepareMedia(
    database,
    mapped.messageSources,
    bindings,
    tables.get('_media') ?? [],
  );
  const pendingIds = new Set(
    [...media.choices.values()].filter((item) => !item.ready).map((item) => item.object.id),
  );
  summary.counts.mediaObjects = media.objects.length;
  summary.counts.mediaNeedInput = pendingIds.size;
  summary.counts.mediaInputBytes = media.objects
    .filter((object) => pendingIds.has(object.id))
    .reduce((sum, object) => sum + Number(object.asset.bytes ?? 0), 0);
  summary.counts.mediaKnownUnavailable = media.unavailable.size;
  summary.counts.mediaUnresolved = media.unresolved;
  if (onMediaRequired && media.objects.length)
    await onMediaRequired({
      version: 1,
      capturedAt: snapshot.cutoff,
      objects: media.objects,
      avatarBindings: [],
    });
  invariant(media.unresolved === 0, 'FAST_MEDIA_REFERENCE_REVIEW_REQUIRED');
  let ready = new Map(
    [...media.choices.values()]
      .filter((item) => item.ready)
      .map(({ object }) => [
        object.id,
        {
          id: object.id,
          ownerUserId: object.ownerUserId,
          purpose: object.purpose,
          stickerId: object.stickerId,
        },
      ]),
  );
  if (execute && importMedia) {
    const result = await importMedia(media.objects);
    invariant(result.summary?.failed === 0, 'FAST_MEDIA_IMPORT_FAILED');
    ready = result.ready;
    for (const [key, value] of media.choices)
      if (!ready.has(value.object.id)) {
        const outcome = result.outcomes?.find((item) => item.objectId === value.object.id);
        invariant(outcome?.classification === 'missing_file', 'FAST_MEDIA_NOT_READY');
        media.unavailable.set(key, 'missing_file');
      }
  } else if (execute && summary.counts.mediaNeedInput) {
    return {
      ...summary,
      ok: false,
      category: 'FAST_MEDIA_INPUT_REQUIRED',
      accountsAndRelationsApplied: true,
    };
  } else if (execute && media.objects.length) {
    invariant(typeof verifyReadyMedia === 'function', 'FAST_MEDIA_READY_VERIFIER_REQUIRED');
    ready = (await verifyReadyMedia(media.objects)).ready;
  }
  summary.counts.mediaKnownUnavailable = media.unavailable.size;
  const incomingByConversation = new Map(),
    pendingMediaKeys = new Set();
  let skippedRows = 0;
  for (const source of mapped.messageSources) {
    const relation = bindings.get(source.sourceKey);
    if (!relation) {
      skippedRows++;
      continue;
    }
    const key = `${source.table}:${source.row.id}`,
      choice = media.choices.get(key),
      missing = media.unavailable.get(key);
    if (choice && !ready.has(choice.object.id) && !missing) {
      pendingMediaKeys.add(key);
      continue;
    }
    const peer =
      source.table === 'group_messages' && source.characterId
        ? relation.characterParticipants.find(
            (participant) => participant.characterId === source.characterId,
          )?.participantId
        : relation.peerParticipantId;
    const binding = {
      ...relation,
      legacyOwnerUserId: source.sourceOwner,
      peerParticipantId: peer,
      ...(choice && !missing ? { mediaId: choice.object.id } : {}),
    };
    const prepared = prepareFastChatRows({
      rows: [source.row],
      table: source.table,
      mapping: () => binding,
      cutoff: snapshot.cutoff,
      sourceDigest,
      mediaReady: ready,
      validateContent,
      missingMedia: missing
        ? [
            {
              table: source.table,
              sourceId: String(source.row.id),
              ownerUserId: source.sourceOwner,
              sourceRowDigest: fingerprint(source.row),
              reason: missing,
            },
          ]
        : [],
    });
    const list = incomingByConversation.get(binding.conversationId) ?? [];
    list.push(...prepared.messages);
    incomingByConversation.set(binding.conversationId, list);
  }
  summary.deferred.messagesInProtectedOrUnmappedRelations = skippedRows;
  summary.counts.messagesWaitingForMedia = pendingMediaKeys.size;
  const readCursors = new Map(
    (tables.get('chat_read_cursors') ?? []).map((row) => [
      `${row.user_id}\0${row.persona_name}`,
      row.last_read_id,
    ]),
  );
  summary.counts.chatInserted = 0;
  summary.counts.chatAlreadyPresent = 0;
  summary.counts.chatNewConversationPlanRows = 0;
  for (const [conversationId, incoming] of incomingByConversation) {
    const exists = (
      await database.query('SELECT id FROM chat.conversations WHERE id=$1', [conversationId])
    ).rows.length;
    if (!exists && !execute) {
      summary.counts.chatNewConversationPlanRows += incoming.length;
      continue;
    }
    const target = await readConversationBaseline(database, conversationId);
    let newConversationReadCursor;
    if (
      Number(target.conversation.last_seq) === 0 &&
      target.messages.length === 0 &&
      incoming.every((row) => row.source.table === 'chat_history')
    ) {
      const raws = mapped.messageSources.filter(
        (row) =>
          bindings.get(row.sourceKey)?.conversationId === conversationId &&
          row.table === 'chat_history',
      );
      const names = new Set(raws.map((row) => row.row.persona_name));
      const value =
        names.size === 1
          ? readCursors.get(`${target.conversation.owner_user_id}\0${raws[0].row.persona_name}`)
          : null;
      if (value != null) {
        invariant(
          Number.isSafeInteger(Number(value)) && Number(value) >= 0,
          'FAST_SOURCE_READ_CURSOR_INVALID',
        );
        newConversationReadCursor = {
          verified: true,
          userId: target.conversation.owner_user_id,
          table: 'chat_history',
          lastReadSourceId: String(value),
        };
      }
    }
    const plan = planFastConversation({
      sourceDigest,
      target,
      incoming,
      initialCutoff: INITIAL,
      cutoff: snapshot.cutoff,
      protection: { inventoryComplete: true },
      newConversationReadCursor,
    });
    invariant(!plan.conflicts.length, 'FAST_CHAT_CONFLICT');
    summary.counts.chatAlreadyPresent += plan.excluded.filter(
      (row) => row.reason === 'already_present',
    ).length;
    if (execute && plan.changed) {
      await assertTargetStopped(database);
      await applyFastConversation({
        database,
        plan,
        sourceDigest,
        crypto,
        validateContent,
        execution: execFor(plan),
        execute: true,
      });
    }
    summary.counts.chatInserted += plan.newMessages.length;
  }
  progress('chat');
  const deletion = await collectFastDeletionFragments(database, tables, snapshot.cutoff);
  const deletionPlan = await planFastDeletions({
    database,
    fragments: deletion.fragments,
    sourceDigest,
    cutoff: snapshot.cutoff,
  });
  summary.counts.deletionFragments = deletionPlan.found;
  summary.counts.deletionMissingFirst = deletion.missingFirst;
  summary.deferred.unknownDeletionScope = deletion.unknownScope;
  if (execute) {
    await assertTargetStopped(database);
    summary.counts.hidden = (
      await applyFastDeletions({
        database,
        plan: deletionPlan,
        execution: execFor(deletionPlan),
        execute: true,
      })
    ).hidden;
  }
  const ordinary = (
    await database.query("SELECT id FROM identity.users WHERE status='active' AND role='user'")
  ).rows.filter((row) => !isMigrationOwnerPreserved(row.id));
  if (!execute)
    for (const item of accountPlan.insert)
      if (!ordinary.some((user) => user.id === item.id)) ordinary.push({ id: item.id });
  const legacyUsers = new Map(
    sourceUsers.filter((row) => row.status === 'active').map((row) => [row.id, row]),
  );
  summary.counts.benefitUsers = ordinary.length;
  summary.counts.compensationMicrosCeil = 0;
  summary.counts.compensationMicrosProportional = 0;
  summary.counts.welcomePoints = ordinary.length * 100;
  summary.counts.benefitsApplied = 0;
  summary.counts.benefitsAlreadyApplied = 0;
  summary.counts.welcomeGrantedMicros = 0;
  summary.counts.compensationGrantedMicros = 0;
  const financeAt = benefitCutoverAt ?? snapshot.cutoff;
  for (const user of ordinary) {
    const old = legacyUsers.get(user.id),
      input = {
        userId: user.id,
        legacyTier: old?.membership_level ?? null,
        legacyExpiresAt: sourceExpiry(old),
        cutoverAt: financeAt,
        rounding,
      };
    for (const rule of ['ceil', 'proportional'])
      summary.counts[
        rule === 'ceil' ? 'compensationMicrosCeil' : 'compensationMicrosProportional'
      ] += calculateMigrationCompensation({ ...input, rounding: rule }).amountMicros;
    if (execute) {
      const result = await database.transaction((tx) => applyMigrationBenefits(tx, input));
      summary.counts.benefitsApplied += result.status === 'applied' ? 1 : 0;
      summary.counts.benefitsAlreadyApplied += result.status === 'already_applied' ? 1 : 0;
      summary.counts.welcomeGrantedMicros += result.welcomeMicros ?? 0;
      summary.counts.compensationGrantedMicros += result.compensationMicros ?? 0;
    }
  }
  progress('benefits');
  return {
    ...summary,
    ok: true,
    retainedAtSource: summary.deferred,
    sourceFreezeCheck: snapshot.freezeCheck,
  };
}

async function cli() {
  const args = new Map();
  let execute = false,
    planMode = false;
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (key === '--execute') {
      execute = true;
      continue;
    }
    if (key === '--plan') {
      planMode = true;
      continue;
    }
    invariant(
      [
        '--confirm-maintenance',
        '--expected-database',
        '--expected-oid',
        '--expected-source-digest',
        '--operator-id',
        '--rounding',
        '--benefit-cutover-at',
        '--media-plan-fd',
        '--source-ssh-settings',
      ].includes(key) && process.argv[i + 1],
      'FAST_ARGUMENT_INVALID',
    );
    args.set(key, process.argv[++i]);
  }
  invariant(!(execute && planMode), 'FAST_ARGUMENT_MODE_CONFLICT');
  const input = await readFastSnapshot(process.stdin),
    config = loadConfig(),
    clock = new SystemClock(),
    ring = loadKekRing(config);
  const database = new Database({ url: config.database.url, poolMax: 1, onError: () => {} });
  database.pool.options.application_name = 'fast-cutover-20261109';
  const crypto = new EnvelopeCrypto(database, clock, ring),
    audit = new AuditLog(database, clock);
  const forbidden = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('FAST_UNEXPECTED_SERVICE_SIDE_EFFECT');
      },
    },
  );
  const settings = new SettingsService(database, forbidden, clock, forbidden, forbidden, forbidden);
  const profiles = new Map((input.tables.get('app_users') ?? []).map((row) => [row.id, row]));
  let invalidProfileFields = 0;
  try {
    const createDefaults = async (tx, id, zone) => {
      await settings.createDefaults(tx, id, zone);
      const row = profiles.get(id);
      if (!row) return;
      const values = {
        nickname: row.nickname || row.display_name || null,
        birthday: row.birthday || null,
        gender: row.gender || 'unspecified',
        city: row.region || null,
        about: row.signature || null,
      };
      const patch = {};
      for (const [field, value] of Object.entries(values)) {
        const result = UpdateProfileRequest.shape[field].safeParse(value);
        if (result.success) patch[field] = result.data;
        else invalidProfileFields++;
      }
      const keys = Object.keys(patch);
      if (keys.length)
        await tx.query(
          `UPDATE identity.profiles SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(',')} WHERE user_id=$1`,
          [id, ...keys.map((key) => patch[key])],
        );
    };
    const onMediaRequired = args.has('--media-plan-fd')
      ? async (plan) => {
          const fd = Number(args.get('--media-plan-fd'));
          invariant(Number.isSafeInteger(fd) && fd > 2, 'FAST_PRIVATE_MEDIA_FD_REQUIRED');
          const stat = fstatSync(fd);
          invariant(stat.isFIFO() || stat.isSocket(), 'FAST_PRIVATE_MEDIA_PIPE_REQUIRED');
          const bytes = Buffer.from(JSON.stringify(plan) + '\n');
          try {
            let offset = 0;
            while (offset < bytes.length)
              offset += writeSync(fd, bytes, offset, bytes.length - offset);
          } finally {
            bytes.fill(0);
          }
        }
      : undefined;
    let mediaTools;
    const getMediaTools = () =>
      (mediaTools ??= Promise.all([
        import('./fast-cutover-media.mjs'),
        import('./fast-cutover-media-runtime.mjs'),
      ]).then(([{ importFastCutoverMedia }, { createFastCutoverMediaRuntime }]) => ({
        importFastCutoverMedia,
        ...createFastCutoverMediaRuntime({ database, config, clock, crypto, audit, apply: true }),
      })));
    const verifyReadyMedia = execute
      ? async (objects) => {
          const { importFastCutoverMedia, media } = await getMediaTools();
          const result = await importFastCutoverMedia({
            objects,
            database,
            media,
            adminId: args.get('--operator-id'),
            execute: true,
          });
          invariant(result.summary.failed === 0, 'FAST_MEDIA_READY_VERIFICATION_FAILED');
          return result;
        }
      : undefined;
    let importMedia;
    if (execute && args.has('--source-ssh-settings')) {
      // Metadata only. No private key, password, host discovery or master startup is accepted here.
      const settingsPath = args.get('--source-ssh-settings');
      invariant(/\.json$/iu.test(settingsPath), 'FAST_MEDIA_SSH_SETTINGS_JSON_REQUIRED');
      const bytes = readFileSync(settingsPath);
      let sshSettings;
      try {
        invariant(bytes.length <= 16384, 'FAST_MEDIA_SSH_SETTINGS_TOO_LARGE');
        sshSettings = JSON.parse(bytes.toString('utf8'));
      } finally {
        bytes.fill(0);
      }
      const allowed = [
        'controlPath',
        'knownHostsFile',
        'sshAuthSock',
        'sourceScriptPath',
        'sourceRoot',
        'timeoutMs',
      ];
      invariant(
        sshSettings &&
          typeof sshSettings === 'object' &&
          !Array.isArray(sshSettings) &&
          Object.keys(sshSettings).every((key) => allowed.includes(key)) &&
          allowed.slice(0, 5).every((key) => typeof sshSettings[key] === 'string'),
        'FAST_MEDIA_SSH_SETTINGS_METADATA_ONLY',
      );
      const { createFastCutoverSshMediaReader } = await import('./fast-cutover-media-ssh.mjs');
      // The factory validates metadata only. Its callback can only multiplex root's existing master.
      const readSource = createFastCutoverSshMediaReader(sshSettings);
      importMedia = async (objects) => {
        const { importFastCutoverMedia, media, normalize } = await getMediaTools();
        return importFastCutoverMedia({
          objects,
          database,
          media,
          normalize,
          adminId: args.get('--operator-id'),
          readSource,
          execute: true,
        });
      };
    }
    const result = await runFastCutover({
      ...input,
      database,
      crypto,
      createDefaults,
      execute,
      expectedDatabase: args.get('--expected-database'),
      expectedOid: args.get('--expected-oid'),
      expectedSourceDigest: args.get('--expected-source-digest'),
      confirmMaintenance: args.get('--confirm-maintenance'),
      operatorId: args.get('--operator-id'),
      rounding: args.get('--rounding'),
      benefitCutoverAt: args.get('--benefit-cutover-at'),
      importMedia,
      onMediaRequired,
      verifyReadyMedia,
      onProgress: (value) => process.stderr.write(JSON.stringify(value) + '\n'),
    });
    process.stdout.write(JSON.stringify({ ...result, invalidProfileFields }) + '\n');
    if (!result.ok) process.exitCode = 2;
  } finally {
    input.tables.clear();
    profiles.clear();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
    await database.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cli();
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ ok: false, category: safeCode(error), partialCommitPossible: true }) + '\n',
    );
    process.exitCode = 1;
  }
}
