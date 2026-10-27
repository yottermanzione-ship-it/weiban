#!/usr/bin/env node
/** One-time operator migration. No app bootstrap, AI jobs, notifications or historical re-billing. */
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip } from 'node:zlib';
import { Database } from '../../apps/server/src/platform/db/database.ts';
import { loadConfig } from '../../apps/server/src/platform/config/config.ts';
import { loadKekRing } from '../../apps/server/src/platform/crypto/kek-ring.ts';
import { EnvelopeCrypto } from '../../apps/server/src/platform/crypto/envelope.ts';
import { SystemClock } from '../../apps/server/src/platform/clock/clock.ts';
import { AuditLog } from '../../apps/server/src/platform/audit/audit-log.ts';
import { MessageContent } from '../../packages/contracts/src/http/chat.ts';
import {
  legacyId,
  legacyTime,
  deletedLegacyMessage,
  legacyNameIndex,
  visibleLegacyInteraction,
  legacyMediaSource,
  legacyMessageContents,
} from './legacy-content-rules.mjs';

const options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--apply') options.set(arg, true);
  else if (
    ['--input', '--manifest', '--report', '--media-plan', '--phase', '--operator-id'].includes(
      arg,
    ) &&
    process.argv[i + 1]
  )
    options.set(arg, process.argv[++i]);
  else throw new Error('ARGUMENT_INVALID');
}
const phase = options.get('--phase') ?? 'chat';
if (!['chat', 'moments'].includes(phase)) throw new Error('PHASE_INVALID');
const config = loadConfig(),
  clock = new SystemClock(),
  ring = loadKekRing(config);
const db = new Database({ url: config.database.url, poolMax: 1 });
const crypto = new EnvelopeCrypto(db, clock, ring),
  audit = new AuditLog(db, clock);
const OP = options.get('--operator-id');
const stats = {
  phase,
  createdCharacters: 0,
  conversations: 0,
  insertedMessages: 0,
  existingMessages: 0,
  deletedRowsNotResurrected: 0,
  contacts: 0,
  posts: 0,
  comments: 0,
  likes: 0,
  privateLegacyCharacters: [],
  mediaMissing: 0,
  mediaReferences: 0,
  longVoiceRows: 0,
  aiPausedUsers: 0,
};
const reportIssues = [];
const output = (value) => process.stdout.write(JSON.stringify(value) + '\n');
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function loadSnapshot(file) {
  const tables = new Map();
  const lines = readline.createInterface({
    input: fs.createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    const { table, row } = JSON.parse(line);
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table).push(row);
  }
  return tables;
}
async function insertRows(tx, table, columns, rows, conflict = 'ON CONFLICT DO NOTHING') {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200),
      values = [];
    const tuples = batch.map(
      (row) =>
        '(' +
        columns
          .map((_, i) => {
            values.push(row[i] ?? null);
            return '$' + values.length;
          })
          .join(',') +
        ')',
    );
    if (!batch.length) continue;
    const result = await tx.query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')} ${conflict}`,
      values,
    );
    inserted += result.rowCount;
  }
  return inserted;
}
async function main() {
  if (
    !OP ||
    !options.get('--input') ||
    !options.get('--manifest') ||
    !options.get('--report') ||
    !options.get('--media-plan')
  )
    throw new Error('REQUIRED_ARGUMENT_MISSING');
  const admin = (
    await db.query(
      "SELECT 1 FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
      [OP],
    )
  ).rows;
  if (!admin.length) throw new Error('ACTIVE_ADMIN_REQUIRED');
  const data = await loadSnapshot(options.get('--input'));
  const capturedAt = data.get('_snapshot')[0].capturedAt;
  const manifest = readJson(options.get('--manifest'));
  // Additional local built-in stickers may be packaged separately without changing the snapshot.
  const extraPath = path.join(
    path.dirname(options.get('--manifest')),
    'content-extra-manifest.json',
  );
  if (fs.existsSync(extraPath)) manifest.assets.push(...readJson(extraPath).assets);
  manifest.bySource = new Map(manifest.assets.map((a) => [a.source, a]));
  const users = new Set(
    (await db.query("SELECT id FROM identity.users WHERE status='active'")).rows.map((r) => r.id),
  );
  const sourceUsers = data.get('app_users');
  for (const u of sourceUsers) if (!users.has(u.id)) throw new Error('SOURCE_USER_NOT_IMPORTED');
  const characters = (
    await db.query('SELECT id,name,kind,owner_id,legacy_card FROM characters.characters')
  ).rows;
  const lookupGlobal = legacyNameIndex(characters.filter((c) => c.kind === 'preset'));
  const privateNames = new Map(
    characters
      .filter((c) => c.owner_id && c.legacy_card?.legacy_source === 'orphan_history')
      .map((c) => [c.owner_id + '\0' + c.name, c.id]),
  );
  const privateRoles = new Map();
  function character(owner, name) {
    const resolved = lookupGlobal(name) ?? privateNames.get(owner + '\0' + name);
    if (resolved) return resolved;
    const id = legacyId('orphan-character', owner, name);
    if (!privateRoles.has(id))
      privateRoles.set(id, {
        id,
        owner,
        name: String(name),
        legacy: {
          id,
          display_name: String(name),
          core_persona: '',
          legacy_source: 'orphan_history',
        },
      });
    return id;
  }
  const oldConversations = (await db.query('SELECT * FROM chat.conversations')).rows;
  const existingDirect = new Map(
    oldConversations
      .filter((c) => c.type === 'direct')
      .map((c) => [c.owner_user_id + '\0' + c.character_id, c]),
  );
  const existingById = new Map(oldConversations.map((c) => [c.id, c]));
  const participants = (
    await db.query('SELECT id,conversation_id,kind,ref_id FROM chat.participants')
  ).rows;
  const participantIds = new Map(
    participants.map((p) => [p.conversation_id + '\0' + p.kind + '\0' + p.ref_id, p.id]),
  );
  const friendships = new Set(),
    friendsByName = new Map(),
    viewersByName = new Map(),
    friendRows = new Map();
  for (const friend of data.get('user_friends') ?? []) {
    if (!users.has(friend.user_id)) continue;
    const cid = character(friend.user_id, friend.persona_name),
      key = friend.user_id + '\0' + cid;
    friendships.add(key);
    friendRows.set(key, friend);
    if (!friendsByName.has(friend.user_id)) friendsByName.set(friend.user_id, new Set());
    friendsByName.get(friend.user_id).add(String(friend.persona_name));
    if (!viewersByName.has(String(friend.persona_name)))
      viewersByName.set(String(friend.persona_name), new Set());
    viewersByName.get(String(friend.persona_name)).add(friend.user_id);
  }
  const mediaObjects = new Map();
  function mediaRef(owner, purpose, row) {
    const asset = legacyMediaSource(row, manifest);
    if (!asset) {
      stats.mediaMissing++;
      return null;
    }
    const id = legacyId('media', owner, purpose, asset.path);
    const stickerId = purpose === 'user_sticker' ? legacyId('user-sticker', owner, id) : null;
    if (!mediaObjects.has(id))
      mediaObjects.set(id, {
        id,
        ownerUserId: owner,
        purpose,
        asset,
        stickerId,
        durationMs: row.audio_duration ? Math.round(Number(row.audio_duration) * 1000) : null,
      });
    stats.mediaReferences++;
    return { id, stickerId };
  }
  // Profiles and group avatars use the same deterministic, private media plan.
  const avatarBindings = [];
  for (const row of sourceUsers)
    if (row.avatar_url) {
      const ref = mediaRef(row.id, 'user_avatar', row);
      if (ref) avatarBindings.push({ table: 'identity.profiles', userId: row.id, mediaId: ref.id });
    }
  const contexts = new Map();
  const cursors = new Map(
    (data.get('chat_read_cursors') ?? []).map((r) => [
      r.user_id + '\0' + r.persona_name,
      Number(r.last_read_id) || 0,
    ]),
  );
  function part(ctx, kind, refId, left = false) {
    const key = ctx.id + '\0' + kind + '\0' + refId;
    const id = participantIds.get(key) ?? legacyId('participant', ctx.id, kind, refId);
    if (!ctx.participants.has(id)) ctx.participants.set(id, { id, kind, refId, left });
    return id;
  }
  function direct(owner, name) {
    const cid = character(owner, name),
      key = owner + '\0' + cid;
    const existing = existingDirect.get(key),
      id = existing?.id ?? legacyId('direct-conversation', owner, cid);
    if (!contexts.has(id))
      contexts.set(id, {
        id,
        owner,
        characterId: cid,
        type: 'direct',
        title: null,
        archived: !friendships.has(key),
        systemId: existing?.system_participant_id ?? legacyId('system-participant', id),
        participants: new Map(),
        messages: [],
        dates: [],
        readOldId: 0,
        friend: friendRows.get(key) ?? null,
      });
    const ctx = contexts.get(id);
    ctx.readOldId = Math.max(ctx.readOldId, cursors.get(owner + '\0' + name) ?? 0);
    part(ctx, 'user', owner);
    part(ctx, 'character', cid);
    return ctx;
  }
  for (const f of data.get('user_friends') ?? [])
    if (users.has(f.user_id))
      direct(f.user_id, f.persona_name).dates.push(legacyTime(f.added_at, capturedAt));
  const groups = new Map();
  for (const g of data.get('chat_groups') ?? []) {
    if (!users.has(g.user_id)) throw new Error('GROUP_OWNER_NOT_IMPORTED');
    const id = legacyId('group-conversation', g.id),
      old = existingById.get(id);
    const ctx = {
      id,
      oldId: g.id,
      owner: g.user_id,
      characterId: null,
      type: 'group',
      title: String(g.name || '旧群聊'),
      archived: Boolean(g.archived),
      systemId: old?.system_participant_id ?? legacyId('system-participant', id),
      participants: new Map(),
      messages: [],
      dates: [legacyTime(g.created_at, capturedAt)],
      readOldId: null,
      friend: null,
    };
    contexts.set(id, ctx);
    groups.set(String(g.id), ctx);
    part(ctx, 'user', ctx.owner);
    if (g.avatar) {
      const ref = mediaRef(ctx.owner, 'group_avatar', g);
      if (ref)
        avatarBindings.push({ table: 'chat.conversations', conversationId: id, mediaId: ref.id });
    }
  }
  const groupMembers = new Map();
  for (const r of data.get('chat_group_members') ?? []) {
    const ctx = groups.get(String(r.group_id));
    if (!ctx) {
      reportIssues.push({ table: 'chat_group_members', id: r.id, reason: 'group_missing' });
      continue;
    }
    const cid = character(ctx.owner, r.character_name);
    part(ctx, 'character', cid);
    groupMembers.set(String(r.group_id) + '\0' + r.character_name, cid);
  }
  function append(ctx, row, table) {
    if (deletedLegacyMessage(row)) {
      stats.deletedRowsNotResurrected++;
      return;
    }
    const date = legacyTime(row.created_at, capturedAt);
    ctx.dates.push(date);
    let kind, sender;
    if (table === 'chat_history') {
      kind =
        row.role === 'user'
          ? 'user'
          : ['assistant', 'character'].includes(row.role)
            ? 'character'
            : 'system';
      sender =
        kind === 'system'
          ? ctx.systemId
          : part(ctx, kind, kind === 'user' ? ctx.owner : ctx.characterId);
    } else {
      kind =
        row.sender_type === 'user'
          ? 'user'
          : ['assistant', 'character'].includes(row.sender_type)
            ? 'character'
            : 'system';
      const cid = kind === 'character' ? character(ctx.owner, row.sender_name) : null;
      sender =
        kind === 'system'
          ? ctx.systemId
          : part(
              ctx,
              kind,
              kind === 'user' ? ctx.owner : cid,
              kind === 'character' &&
                !groupMembers.has(String(row.group_id) + '\0' + row.sender_name),
            );
    }
    if (['system', 'call'].includes(row.message_type)) {
      kind = 'system';
      sender = ctx.systemId;
    }
    const purpose =
      row.message_type === 'voice'
        ? kind === 'user'
          ? 'chat_voice'
          : 'generated_voice'
        : row.message_type === 'sticker'
          ? 'user_sticker'
          : 'chat_image';
    const ref = ['voice', 'image', 'sticker'].includes(row.message_type)
      ? mediaRef(ctx.owner, purpose, row)
      : null;
    if (row.message_type === 'voice' && Number(row.audio_duration) > 300) stats.longVoiceRows++;
    const contents = legacyMessageContents(row, ref);
    for (let i = 0; i < contents.length; i++) {
      const parsed = MessageContent.safeParse(contents[i]);
      if (!parsed.success) throw new Error('GENERATED_MESSAGE_SCHEMA_INVALID');
      ctx.messages.push({
        id: legacyId('message', table, String(row.id), i),
        content: parsed.data,
        sourceId: Number(row.id) || 0,
        key: legacyId('client-message', table, String(row.id), i),
        part: i,
        sender,
        kind,
        createdAt: date,
      });
    }
  }
  for (const r of data.get('chat_history') ?? []) {
    if (!users.has(r.user_id)) throw new Error('MESSAGE_OWNER_NOT_IMPORTED');
    append(direct(r.user_id, r.persona_name), r, 'chat_history');
  }
  for (const r of data.get('group_messages') ?? []) {
    const ctx = groups.get(String(r.group_id));
    if (!ctx) {
      reportIssues.push({ table: 'group_messages', id: r.id, reason: 'group_missing' });
      continue;
    }
    append(ctx, r, 'group_messages');
  }
  for (const ctx of contexts.values())
    ctx.messages.sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.sourceId - b.sourceId || a.part - b.part,
    );
  const interactions = new Map();
  for (const r of data.get('moment_interactions') ?? []) {
    if (!interactions.has(String(r.moment_id))) interactions.set(String(r.moment_id), []);
    interactions.get(String(r.moment_id)).push(r);
  }
  const posts = [];
  for (const row of data.get('moments') ?? []) {
    const owners =
      row.author_type === 'user'
        ? users.has(row.author_id)
          ? [row.author_id]
          : []
        : [...(viewersByName.get(String(row.author_id)) ?? [])];
    if (!owners.length) {
      reportIssues.push({
        table: 'moments',
        id: row.id,
        reason: 'not_currently_visible_to_any_user_retained_in_snapshot',
      });
      continue;
    }
    for (const owner of owners) {
      const id = legacyId('moment', owner, String(row.id)),
        cid = row.author_type === 'character' ? character(owner, row.author_id) : null;
      const ref = row.image_url ? mediaRef(owner, 'moments_image', row) : null;
      const visible = (interactions.get(String(row.id)) ?? []).filter((i) =>
        visibleLegacyInteraction(i, owner, friendsByName.get(owner) ?? new Set()),
      );
      for (const item of visible)
        if (item.actor_type === 'character') character(owner, item.actor_name);
      posts.push({ id, owner, cid, row, ref, visible });
    }
  }
  stats.plannedConversations = contexts.size;
  stats.plannedMessages = [...contexts.values()].reduce((n, c) => n + c.messages.length, 0);
  stats.plannedPostCopies = posts.length;
  stats.privateLegacyCharacters = [...privateRoles.values()].map((r) => ({
    id: r.id,
    owner: r.owner,
    name: r.name,
  }));
  const mediaPlan = { version: 1, capturedAt, objects: [...mediaObjects.values()], avatarBindings };
  fs.writeFileSync(options.get('--media-plan'), JSON.stringify(mediaPlan), { mode: 0o600 });
  if (!options.get('--apply')) {
    fs.writeFileSync(
      options.get('--report'),
      JSON.stringify({ ok: true, mode: 'plan', capturedAt, stats, issues: reportIssues }, null, 2),
      { mode: 0o600 },
    );
    output({
      ok: true,
      mode: 'plan',
      stats: { ...stats, privateLegacyCharacters: stats.privateLegacyCharacters.length },
      issues: reportIssues.length,
    });
    return;
  }
  await db.query("SELECT pg_advisory_lock(hashtextextended('legacy-content-migration-v1',0))");
  // No imported event may trigger greetings, retrospective replies, or automatic paid work.
  const paused = await db.query(
    'UPDATE identity.notification_settings SET proactive_messages_enabled=false,proactive_calls_enabled=false WHERE user_id=ANY($1::uuid[]) AND (proactive_messages_enabled OR proactive_calls_enabled)',
    [sourceUsers.map((u) => u.id)],
  );
  stats.aiPausedUsers = paused.rowCount;
  for (const r of privateRoles.values()) {
    const result = await db.query(
      "INSERT INTO characters.characters(id,owner_id,kind,status,name,search_text,basis,real_person_kind,age_setting,child_appearance,child_features_detected,published_child_features_detected,legacy_card,checks,created_at,updated_at) VALUES($1,$2,'custom','draft',$3,$3,'original',NULL,'minor',false,false,false,$4::jsonb,$5::jsonb,$6,$6) ON CONFLICT DO NOTHING",
      [
        r.id,
        r.owner,
        r.name.slice(0, 32),
        JSON.stringify(r.legacy),
        JSON.stringify({
          revision: 1,
          requiredFieldsComplete: false,
          personaStabilityPassed: false,
          hardBoundaryCasesPassed: false,
          hasFallbackGreeting: false,
          checked: false,
        }),
        capturedAt,
      ],
    );
    stats.createdCharacters += result.rowCount;
  }
  if (phase === 'chat') {
    let done = 0;
    for (const ctx of contexts.values()) {
      await db.transaction(async (tx) => {
        const dates = ctx.dates.sort(),
          createdAt = dates[0] ?? capturedAt,
          updatedAt = dates.at(-1) ?? capturedAt;
        await tx.query(
          "INSERT INTO chat.conversations(id,owner_user_id,type,character_id,title,system_participant_id,content_scope,last_seq,archived_at,created_at,updated_at,title_customized,create_key) VALUES($1,$2,$3,$4,$5,$6,'normal',0,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING",
          [
            ctx.id,
            ctx.owner,
            ctx.type,
            ctx.characterId,
            ctx.title,
            ctx.systemId,
            ctx.archived ? capturedAt : null,
            createdAt,
            updatedAt,
            ctx.type === 'group',
            ctx.type === 'group' ? `legacy-group:${ctx.oldId}` : null,
          ],
        );
        const lock = (
          await tx.query('SELECT id,last_seq FROM chat.conversations WHERE id=$1 FOR UPDATE', [
            ctx.id,
          ])
        ).rows[0];
        if (!lock) throw new Error('CONCURRENT_CONVERSATION_CONFLICT');
        let seq = Number(lock.last_seq);
        await insertRows(
          tx,
          'chat.participants',
          ['id', 'conversation_id', 'kind', 'ref_id', 'joined_at', 'read_seq', 'left_at'],
          [...ctx.participants.values()].map((p) => [
            p.id,
            ctx.id,
            p.kind,
            p.refId,
            createdAt,
            0,
            p.left ? capturedAt : null,
          ]),
        );
        if (ctx.friend) {
          const f = ctx.friend,
            at = legacyTime(f.added_at, createdAt);
          const res = await tx.query(
            "INSERT INTO contacts.contacts(id,user_id,character_id,status,request_id,acceptance_mode,accept_after,known_since,added_at,conversation_id,relationship_type) VALUES($1,$2,$3,'active',$4,'restored',$5,$6,$5,$7,'朋友') ON CONFLICT DO NOTHING",
            [
              legacyId('contact', ctx.owner, ctx.characterId),
              ctx.owner,
              ctx.characterId,
              legacyId('contact-request', ctx.owner, ctx.characterId),
              at,
              at.slice(0, 10),
              ctx.id,
            ],
          );
          stats.contacts += res.rowCount;
        }
        const existing = (
          await tx.query(
            'SELECT id,client_msg_id,seq FROM chat.messages WHERE conversation_id=$1',
            [ctx.id],
          )
        ).rows;
        const old = new Map(existing.map((m) => [m.id, Number(m.seq)]));
        const fresh = ctx.messages.filter((m) => !old.has(m.id));
        stats.existingMessages += ctx.messages.length - fresh.length;
        let readSeq = ctx.type === 'group' ? seq : 0;
        for (let start = 0; start < fresh.length; start += 200) {
          const batch = fresh.slice(start, start + 200);
          const sealed = await crypto.sealMany(
            ctx.owner,
            batch.map((m) => ({
              aad: `chat:message:${m.id}`,
              plaintext: JSON.stringify(m.content),
            })),
            tx,
          );
          const rows = batch.map((m, i) => {
            seq++;
            old.set(m.id, seq);
            return [
              m.id,
              ctx.id,
              seq,
              m.sender,
              m.kind,
              m.key,
              sealed[i],
              'normal',
              'normal',
              m.content.type,
              m.createdAt,
            ];
          });
          stats.insertedMessages += await insertRows(
            tx,
            'chat.messages',
            [
              'id',
              'conversation_id',
              'seq',
              'sender_participant_id',
              'sender_kind',
              'client_msg_id',
              'content_ciphertext',
              'status',
              'scope',
              'content_type',
              'created_at',
            ],
            rows,
          );
        }
        if (ctx.type === 'group') readSeq = seq;
        else
          for (const m of ctx.messages)
            if (m.sourceId <= ctx.readOldId) readSeq = Math.max(readSeq, old.get(m.id) ?? 0);
        await tx.query(
          'UPDATE chat.conversations SET last_seq=$2,updated_at=GREATEST(updated_at,$3::timestamptz) WHERE id=$1',
          [ctx.id, seq, updatedAt],
        );
        await tx.query(
          'INSERT INTO chat.user_conversation_states(conversation_id,user_id,pinned,muted,hidden,cleared_through_seq,read_seq,marked_unread) VALUES($1,$2,false,false,$3,0,$4,false) ON CONFLICT(conversation_id,user_id) DO UPDATE SET read_seq=GREATEST(chat.user_conversation_states.read_seq,EXCLUDED.read_seq)',
          [ctx.id, ctx.owner, ctx.archived, readSeq],
        );
        await tx.query(
          "UPDATE chat.participants SET read_seq=GREATEST(read_seq,$3) WHERE conversation_id=$1 AND kind='user' AND ref_id=$2",
          [ctx.id, ctx.owner, readSeq],
        );
      });
      stats.conversations++;
      done++;
      if (done % 100 === 0)
        output({
          progress: { phase, done, total: contexts.size, messages: stats.insertedMessages },
        });
    }
  } else {
    let done = 0;
    for (const p of posts) {
      await db.transaction(async (tx) => {
        const exists = (await tx.query('SELECT id FROM moments.posts WHERE id=$1', [p.id])).rows
          .length;
        if (exists) return;
        const row = p.row,
          createdAt = legacyTime(row.created_at, capturedAt);
        const text = String(row.content ?? '').replaceAll('\u0000', '');
        const sealed = await crypto.seal(p.owner, `moments:post:${p.id}`, text, tx);
        await tx.query(
          "INSERT INTO moments.posts(id,owner_user_id,author_kind,author_character_id,text_ciphertext,visibility_kind,source_kind,source_id,create_key,created_at) VALUES($1,$2,$3,$4,$5,$6,'legacy_import',$7,$8,$9)",
          [
            p.id,
            p.owner,
            p.cid ? 'character' : 'user',
            p.cid,
            sealed,
            p.cid ? null : 'all_characters',
            String(row.id),
            `legacy-moment:${row.id}`,
            createdAt,
          ],
        );
        if (p.ref)
          await tx.query(
            'INSERT INTO moments.post_media(post_id,position,media_id,width,height) VALUES($1,0,$2,NULL,NULL)',
            [p.id, p.ref.id],
          );
        const comments = p.visible.filter(
          (i) => i.type === 'comment' && String(i.content ?? '').trim(),
        );
        const commentIds = new Map(
          comments.map((i) => [String(i.id), legacyId('moment-comment', p.owner, String(i.id))]),
        );
        const parentComments = new Map(comments.map((i) => [String(i.id), i]));
        const bodies = await crypto.sealMany(
          p.owner,
          comments.map((i) => ({
            aad: `moments:comment:${commentIds.get(String(i.id))}`,
            plaintext: String(i.content).replaceAll('\u0000', ''),
          })),
          tx,
        );
        const commentRows = comments.map((i, index) => {
          const kind = i.actor_type === 'user' ? 'user' : 'character',
            ref = kind === 'user' ? p.owner : character(p.owner, i.actor_name);
          const replyId = commentIds.get(String(i.reply_to_interaction_id)) ?? null;
          const parent = parentComments.get(String(i.reply_to_interaction_id));
          const replyKind = parent
            ? parent.actor_type === 'user'
              ? 'user'
              : 'character'
            : i.reply_to_actor === '我'
              ? 'user'
              : null;
          const replyRef =
            replyKind === 'user'
              ? p.owner
              : parent && replyKind === 'character'
                ? character(p.owner, parent.actor_name)
                : null;
          return [
            commentIds.get(String(i.id)),
            p.id,
            kind,
            ref,
            replyId,
            replyKind,
            replyRef,
            bodies[index],
            i.reply_to_actor === '我',
            `legacy-comment:${i.id}`,
            legacyTime(i.created_at, createdAt),
          ];
        });
        stats.comments += await insertRows(
          tx,
          'moments.comments',
          [
            'id',
            'post_id',
            'author_kind',
            'author_ref_id',
            'reply_to_comment_id',
            'reply_to_kind',
            'reply_to_ref_id',
            'text_ciphertext',
            'mentions_user',
            'create_key',
            'created_at',
          ],
          commentRows,
        );
        const likes = p.visible
          .filter((i) => i.type === 'like')
          .map((i) => [
            p.id,
            i.actor_type === 'user' ? 'user' : 'character',
            i.actor_type === 'user' ? p.owner : character(p.owner, i.actor_name),
            legacyTime(i.created_at, createdAt),
          ]);
        stats.likes += await insertRows(
          tx,
          'moments.likes',
          ['post_id', 'actor_kind', 'actor_ref_id', 'created_at'],
          likes,
        );
        stats.posts++;
      });
      done++;
      if (done % 500 === 0) output({ progress: { phase, done, total: posts.length } });
    }
  }
  if (phase === 'moments')
    await insertRows(
      db,
      'moments.badge_state',
      ['user_id', 'posts_seen_at', 'interactions_seen_at'],
      sourceUsers.map((u) => [u.id, capturedAt, capturedAt]),
    );
  await audit.record({
    module: 'importer',
    action: 'legacy_content.imported',
    actorType: 'admin',
    actorId: OP,
    targetType: 'legacy_content_snapshot',
    details: {
      phase,
      capturedAt,
      messages: stats.insertedMessages,
      posts: stats.posts,
      comments: stats.comments,
      likes: stats.likes,
      contacts: stats.contacts,
      deletedRowsNotResurrected: stats.deletedRowsNotResurrected,
    },
  });
  fs.writeFileSync(
    options.get('--report'),
    JSON.stringify({ ok: true, capturedAt, stats, issues: reportIssues }, null, 2),
    { mode: 0o600 },
  );
  output({
    ok: true,
    capturedAt,
    stats: { ...stats, privateLegacyCharacters: stats.privateLegacyCharacters.length },
    issues: reportIssues.length,
  });
}
main()
  .catch((error) => {
    output({
      ok: false,
      phase,
      code: error.code ?? error.message ?? 'LEGACY_CONTENT_IMPORT_FAILED',
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
    for (const key of ring?.keys.values() ?? []) key.fill(0);
  });
