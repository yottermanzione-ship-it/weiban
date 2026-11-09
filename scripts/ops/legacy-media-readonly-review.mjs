/** Read only the media files referenced by the migration scope. No application imports,
 * URL requests, exports, model calls, metadata updates or plaintext outputs. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { legacyId } from './legacy-content-rules.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TYPES = new Set([
  'chat',
  'group',
  'profile',
  'group_avatar',
  'sticker',
  'moment',
  'preferences',
]);
const EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.avif',
  '.svg',
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.ogg',
  '.opus',
  '.amr',
  '.mp4',
]);
const CATEGORIES = [
  'ready',
  'present_unhashed',
  'missing',
  'no_reference',
  'external_not_fetched',
  'unsupported_reference',
  'path_rejected',
  'empty',
  'too_large',
  'changed',
  'io_error',
  'permission_denied',
  'budget_exceeded',
  'retired',
  'owner_rejected',
];
const OWNER_HASH = (id) =>
  createHash('sha256')
    .update('user:' + String(id).trim().toLowerCase())
    .digest('hex');
const fail = (code) => {
  throw new Error(code);
};
const unchanged = (a, b) =>
  ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((k) => a[k] === b[k]);
const within = (root, file) => {
  const r = path.relative(root, file);
  return !!r && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r);
};
const invalidPathCharacters = (value) =>
  [...value].some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function resolveLegacyMediaReference(value, root) {
  if (typeof value !== 'string' || !value.trim()) return { category: 'no_reference' };
  let raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (
        !['weiban.online', 'www.weiban.online', '152.136.111.51'].includes(url.hostname) ||
        url.username ||
        url.password ||
        !['', '80', '443'].includes(url.port)
      )
        return { category: 'external_not_fetched' };
      raw = url.pathname;
    } catch {
      return { category: 'unsupported_reference' };
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || invalidPathCharacters(raw))
    return { category: 'path_rejected' };
  try {
    raw = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  } catch {
    return { category: 'path_rejected' };
  }
  if (raw.split('/').some((part) => part === '..' || part === '.') || invalidPathCharacters(raw))
    return { category: 'path_rejected' };
  let candidate;
  if (raw.startsWith('/generated/') || raw.startsWith('/stickers/builtin/'))
    candidate = path.resolve(root, 'public', raw.slice(1));
  else if (path.isAbsolute(raw)) candidate = path.resolve(raw);
  else return { category: 'unsupported_reference' };
  const roots = [
    path.resolve(root, 'private', 'chat-media'),
    path.resolve(root, 'public', 'generated'),
    path.resolve(root, 'public', 'stickers', 'builtin'),
  ];
  const allowedRoot = roots.find((r) => within(r, candidate));
  if (!allowedRoot || !EXTENSIONS.has(path.extname(candidate).toLowerCase()))
    return { category: 'path_rejected' };
  return { category: 'candidate', filename: candidate, allowedRoot };
}

async function checkedFile(filename) {
  const parsed = path.parse(filename);
  let current = parsed.root;
  const parts = filename.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = await fs.lstat(current);
    if (
      stat.isSymbolicLink() ||
      (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
    )
      fail('path_rejected');
  }
  if ((await fs.realpath(filename)) !== filename) fail('path_rejected');
  return fs.stat(filename);
}
export async function hashReviewedMedia(
  candidate,
  { maxFileBytes = 64 * 1024 * 1024, budget, onRead } = {},
) {
  let handle, buffer;
  try {
    if (!candidate?.allowedRoot || !within(candidate.allowedRoot, candidate.filename))
      fail('path_rejected');
    const before = await checkedFile(candidate.filename);
    if (!before.size) fail('empty');
    if (before.size > maxFileBytes) fail('too_large');
    if (budget && budget.bytes + before.size > budget.limit) fail('budget_exceeded');
    handle = await fs.open(candidate.filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!unchanged(before, await handle.stat())) fail('changed');
    if (budget) budget.bytes += before.size;
    const hash = createHash('sha256');
    buffer = Buffer.alloc(Math.min(256 * 1024, before.size));
    let position = 0;
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (!bytesRead) fail('changed');
      hash.update(buffer.subarray(0, bytesRead));
      buffer.fill(0);
      position += bytesRead;
      await onRead?.();
    }
    if (
      !unchanged(before, await handle.stat()) ||
      !unchanged(before, await checkedFile(candidate.filename))
    )
      fail('changed');
    return { category: 'ready', bytes: before.size, digest: hash.digest('hex') };
  } catch (error) {
    return {
      category:
        error.code === 'EACCES' || error.code === 'EPERM'
          ? 'permission_denied'
          : error.code === 'ENOENT'
            ? 'missing'
            : CATEGORIES.includes(error.message)
              ? error.message
              : 'io_error',
    };
  } finally {
    buffer?.fill(0);
    await handle?.close();
  }
}

export async function reviewMediaRows(
  rows,
  {
    root = '/opt/weiban-server',
    preservedDigests = [],
    maxTotalBytes = 8 * 1024 * 1024 * 1024,
    maxFileBytes,
    readHook,
    metadataOnly = false,
    onUnresolved,
  } = {},
) {
  const counts = Object.fromEntries(CATEGORIES.map((k) => [k, 0]));
  const byType = Object.fromEntries([...TYPES].map((k) => [k, 0]));
  const details = Object.fromEntries(
    [...TYPES].map((k) => [k, Object.fromEntries(CATEGORIES.map((c) => [c, 0]))]),
  );
  const record = (row, category) => {
    counts[category]++;
    details[row.type][category]++;
  };
  const fileCache = new Map(),
    readyDigests = new Set(),
    budget = { bytes: 0, limit: maxTotalBytes };
  let preserved = 0,
    readyBytes = 0,
    duplicates = 0;
  for (const row of rows) {
    if (!TYPES.has(row.type)) fail('MEDIA_SOURCE_SHAPE_INVALID');
    if (preservedDigests.includes(OWNER_HASH(row.ownerId))) {
      preserved++;
      continue;
    }
    if (row.ownerId !== 'shared-public' && !UUID.test(row.ownerId ?? '')) {
      record(row, 'owner_rejected');
      continue;
    }
    byType[row.type]++;
    if (row.retired) {
      record(row, 'retired');
      continue;
    }
    if (!Array.isArray(row.references) || row.references.some((r) => typeof r !== 'string'))
      fail('MEDIA_SOURCE_SHAPE_INVALID');
    const refs = row.references.filter((r) => r.trim());
    if (!refs.length) {
      record(row, 'no_reference');
      await onUnresolved?.(row, [], 'no_reference');
      continue;
    }
    let outcome;
    const candidates = [];
    for (const ref of [...new Set(refs)]) {
      const candidate = resolveLegacyMediaReference(ref, root);
      if (candidate.category !== 'candidate') {
        outcome ??= candidate;
        continue;
      }
      candidates.push(candidate);
      let reviewed = fileCache.get(candidate.filename);
      if (!reviewed) {
        if (metadataOnly) {
          try {
            const stat = await checkedFile(candidate.filename);
            reviewed = { category: stat.size ? 'present_unhashed' : 'empty' };
          } catch (error) {
            reviewed = {
              category:
                error.code === 'ENOENT'
                  ? 'missing'
                  : error.code === 'EACCES' || error.code === 'EPERM'
                    ? 'permission_denied'
                    : CATEGORIES.includes(error.message)
                      ? error.message
                      : 'io_error',
            };
          }
        } else
          reviewed = await hashReviewedMedia(candidate, { maxFileBytes, budget, onRead: readHook });
        fileCache.set(candidate.filename, reviewed);
        if (reviewed.category === 'ready') {
          readyBytes += reviewed.bytes;
          readyDigests.add(reviewed.digest);
        }
      } else duplicates++;
      outcome = reviewed;
      if (['ready', 'present_unhashed'].includes(reviewed.category)) break;
    }
    const category = (outcome ?? { category: 'no_reference' }).category;
    record(row, category);
    if (!['ready', 'present_unhashed'].includes(category))
      await onUnresolved?.(row, candidates, category);
  }
  return {
    sourceRows: rows.length,
    preservedRows: preserved,
    byType,
    byTypeClassification: details,
    classifications: counts,
    uniqueFilesChecked: fileCache.size,
    uniqueFilesReady: [...fileCache.values()].filter((v) => v.category === 'ready').length,
    uniqueReadyContent: readyDigests.size,
    readyBytes,
    duplicateReferences: duplicates,
    bytesRead: budget.bytes,
    readsOnly: true,
    plaintextReturned: false,
    sourceSnapshotConsistent: false,
    targetBytesVerified: false,
    metadataOnly,
  };
}

/** Queries select media pointers only. Private body/transcript/persona fields are never selected. */
export function readSourceMediaRows(preservedDigests, queryOverride) {
  const query =
    queryOverride ??
    ((sql) => {
      const result = spawnSync(
        'sqlite3',
        ['-readonly', '-batch', '-cmd', '.timeout 5000', '/opt/weiban-server/weiban.db'],
        {
          input: 'PRAGMA query_only=ON; BEGIN;\n' + sql + '\nROLLBACK;',
          encoding: 'utf8',
          timeout: 20000,
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      if (result.status !== 0) fail('MEDIA_SOURCE_READ_FAILED');
      return result.stdout.trim()
        ? result.stdout
            .trim()
            .split(/\r?\n/)
            .map((line) => JSON.parse(line))
        : [];
    });
  const users = query("SELECT json_object('id',id) FROM app_users;");
  if (users.some((u) => !UUID.test(u.id ?? ''))) fail('MEDIA_SOURCE_OWNER_INVALID');
  const allowed = users.map((u) => u.id).filter((id) => !preservedDigests.includes(OWNER_HASH(id)));
  const scope = `SELECT value FROM json_each('${JSON.stringify(allowed)}')`;
  const cols = (table) =>
    new Set(
      query(`SELECT json_object('name',name) FROM pragma_table_info('${table}');`).map(
        (r) => r.name,
      ),
    );
  const all = [];
  for (const [table, type, owner, fieldNames, join] of [
    ['chat_history', 'chat', 'm.user_id', ['media_path', 'audio_url'], ''],
    [
      'group_messages',
      'group',
      'g.user_id',
      ['media_path', 'audio_url'],
      ' JOIN chat_groups g ON g.id=m.group_id',
    ],
    ['app_users', 'profile', 'm.id', ['avatar_url'], ''],
    ['chat_groups', 'group_avatar', 'm.user_id', ['avatar'], ''],
    ['user_stickers', 'sticker', 'm.user_id', ['image_url'], ''],
    [
      'moments',
      'moment',
      "CASE WHEN m.author_type='user' THEN m.author_id ELSE 'shared-public' END",
      ['image_url'],
      '',
    ],
  ]) {
    const columns = cols(table);
    if (!columns.size) fail('MEDIA_SOURCE_SCHEMA_INCOMPLETE');
    const fields = fieldNames.filter((name) => columns.has(name));
    if (!fields.length) fail('MEDIA_SOURCE_SCHEMA_INCOMPLETE');
    const retired = [
      columns.has('deleted_at') ? "coalesce(m.deleted_at,'')<>''" : '0',
      columns.has('media_status') ? "m.media_status IN ('expired','deleted','missing')" : '0',
    ].join(' OR ');
    const restriction =
      table === 'moments'
        ? `(m.author_type<>'user' OR m.author_id IN (${scope}))`
        : `${owner} IN (${scope})`;
    const sender =
      table === 'group_messages' && columns.has('user_id')
        ? ` AND (coalesce(m.user_id,'')='' OR m.user_id IN (${scope}))`
        : '';
    const mediaOnly = ['chat_history', 'group_messages'].includes(table)
      ? " AND m.message_type IN ('image','voice','sticker')"
      : ` AND (${fields.map((f) => `coalesce(m.${f},'')<>''`).join(' OR ')})`;
    const metadata = ['chat_history', 'group_messages'].includes(table)
      ? `,'sourceTable','${table}','sourceId',CAST(m.id AS TEXT),'kind',m.message_type,'role',m.${table === 'chat_history' ? 'role' : 'sender_type'},'createdAt',m.created_at`
      : '';
    all.push(
      ...query(
        `SELECT json_object('ownerId',${owner},'type','${type}','retired',CASE WHEN (${retired}) THEN 1 ELSE 0 END,'references',json_array(${fields.map((f) => `coalesce(m.${f},'')`).join(',')})${metadata}) FROM ${table} m${join} WHERE ${restriction}${sender}${mediaOnly};`,
      ),
    );
  }
  const invalidPreferences = query(
    `SELECT json_object('n',count(*)) FROM user_client_prefs WHERE user_id IN (${scope}) AND NOT json_valid(prefs_json);`,
  )[0].n;
  const preferenceRows = query(
    `SELECT json_object('ownerId',user_id,'versioned',json_extract(prefs_json,'$._sync.v')=1,'backgrounds',json_extract(prefs_json,CASE WHEN json_extract(prefs_json,'$._sync.v')=1 THEN '$._sync.entries.chatBackgrounds' ELSE '$.chatBackgrounds' END),'avatars',json_extract(prefs_json,CASE WHEN json_extract(prefs_json,'$._sync.v')=1 THEN '$._sync.entries.friendAvatars' ELSE '$.friendAvatars' END),'cover',json_extract(prefs_json,CASE WHEN json_extract(prefs_json,'$._sync.v')=1 THEN '$._sync.entries.momentsCover' ELSE '$.momentsCover' END)) FROM user_client_prefs WHERE user_id IN (${scope}) AND json_valid(prefs_json);`,
  );
  let unsupportedPreferences = 0;
  for (const row of preferenceRows)
    for (const [key, value] of Object.entries({
      backgrounds: row.backgrounds,
      avatars: row.avatars,
      cover: row.cover,
    })) {
      const entries = key === 'cover' && !row.versioned ? [value] : Object.values(value ?? {});
      for (const entry of entries) {
        if (row.versioned && entry?.deleted === true) continue;
        const ref = row.versioned ? entry?.value : entry;
        if (ref == null || ref === '') continue;
        if (typeof ref !== 'string') {
          unsupportedPreferences++;
          continue;
        }
        all.push({ ownerId: row.ownerId, type: 'preferences', references: [ref], retired: false });
      }
    }
  return {
    rows: all,
    unsupportedPreferences,
    invalidPreferences,
    preservedAccounts: users.length - allowed.length,
  };
}
export async function runSourceMediaReview(
  preservedDigests,
  { metadataOnly = false, includeUnresolved = false } = {},
) {
  const started = Date.now();
  const source = readSourceMediaRows(preservedDigests);
  const unresolved = [],
    missingPeriods = { beforeInitial: 0, afterInitial: 0, unknown: 0 };
  const preferenceReferenceKinds = {
    androidLocal: 0,
    accountApi: 0,
    mediaApi: 0,
    otherApi: 0,
    other: 0,
  };
  const result = await reviewMediaRows(source.rows, {
    preservedDigests,
    metadataOnly,
    onUnresolved: (row, candidates, category) => {
      if (!['missing', 'no_reference', 'path_rejected', 'external_not_fetched'].includes(category))
        return;
      if (row.type === 'preferences' && category === 'path_rejected') {
        const raw = row.references[0] ?? '';
        let pathname = raw;
        try {
          pathname = new URL(raw).pathname;
        } catch {
          /* Local path. */
        }
        const kind = /^(?:file:|content:|\/data\/|\/storage\/|\/sdcard\/)/.test(raw)
          ? 'androidLocal'
          : pathname.startsWith('/api/account/')
            ? 'accountApi'
            : pathname.startsWith('/api/media/')
              ? 'mediaApi'
              : pathname.startsWith('/api/')
                ? 'otherApi'
                : 'other';
        preferenceReferenceKinds[kind]++;
      }
      if (category === 'missing') {
        const date = Date.parse(row.createdAt ?? '');
        missingPeriods[
          !Number.isFinite(date)
            ? 'unknown'
            : date <= Date.parse('2026-10-24T12:02:47.053609Z')
              ? 'beforeInitial'
              : 'afterInitial'
        ]++;
      }
      if (!includeUnresolved || !['chat', 'group'].includes(row.type)) return;
      const purpose =
        row.kind === 'voice'
          ? row.role === 'user'
            ? 'chat_voice'
            : 'generated_voice'
          : row.kind === 'sticker'
            ? 'user_sticker'
            : 'chat_image';
      unresolved.push({
        category,
        ownerId: row.ownerId,
        messageId: legacyId('message', row.sourceTable, row.sourceId, 0),
        mediaIds: [
          ...new Set(candidates.map((c) => legacyId('media', row.ownerId, purpose, c.filename))),
        ],
      });
    },
  });
  return {
    ...result,
    unsupportedPreferences: source.unsupportedPreferences,
    invalidPreferences: source.invalidPreferences,
    preservedAccounts: source.preservedAccounts,
    observedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    productionReady: false,
    missingPeriods,
    preferenceReferenceKinds,
    ...(includeUnresolved ? { unresolved } : {}),
  };
}
