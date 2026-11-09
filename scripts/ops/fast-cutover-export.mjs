/** Old-host read-only SQLite export. stdout is a private gzip pipe, stderr contains counts/categories only. */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { fstatSync } from 'node:fs';
import { isMigrationOwnerPreserved } from './fast-cutover-owners.mjs';

const INITIAL = '2026-10-24T12:02:47.053609Z';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const names = [
  'app_users',
  'user_friends',
  'chat_groups',
  'chat_group_members',
  'chat_history',
  'group_messages',
  'chat_read_cursors',
];
const fields = {
  app_users: [
    'id',
    'username',
    'password_hash',
    'status',
    'nickname',
    'display_name',
    'avatar_url',
    'gender',
    'region',
    'birthday',
    'signature',
    'membership_level',
    'membership_expire_at',
    'created_at',
    'updated_at',
  ],
  user_friends: ['id', 'user_id', 'persona_name', 'added_at'],
  chat_groups: ['id', 'user_id', 'name', 'archived', 'created_at', 'updated_at'],
  chat_group_members: ['id', 'group_id', 'character_name', 'created_at'],
  chat_history: [
    'id',
    'user_id',
    'persona_name',
    'role',
    'content',
    'created_at',
    'message_type',
    'media_path',
    'audio_url',
    'image_url',
    'audio_duration',
    'deleted_at',
    'deletion_scope',
    'quoted_author',
    'quoted_content',
  ],
  group_messages: [
    'id',
    'group_id',
    'user_id',
    'sender_type',
    'sender_name',
    'content',
    'created_at',
    'message_type',
    'media_path',
    'audio_url',
    'image_url',
    'audio_duration',
    'deleted_at',
    'deletion_scope',
    'quoted_author',
    'quoted_content',
  ],
  chat_read_cursors: ['user_id', 'persona_name', 'last_read_id', 'updated_at'],
};
const need = (value, code) => {
  if (!value) throw new Error(code);
};
function iso(value) {
  need(
    typeof value === 'string' &&
      /(Z|[+-]\d\d:\d\d)$/u.test(value) &&
      Number.isFinite(Date.parse(value)),
    'FAST_EXPORT_CUTOFF_INVALID',
  );
  return new Date(value).toISOString();
}
function stopped(units) {
  need(
    units.length > 0 && units.every((unit) => /^[a-zA-Z0-9_.@-]+\.service$/u.test(unit)),
    'FAST_EXPORT_WRITER_UNITS_REQUIRED',
  );
  return units.map((unit) => {
    const result = spawnSync(
      'systemctl',
      ['show', '--property=LoadState,ActiveState,MainPID', unit],
      { encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    const values = Object.fromEntries(
      String(result.stdout ?? '')
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.split('=')),
    );
    need(
      result.status === 0 &&
        values.LoadState === 'loaded' &&
        values.ActiveState === 'inactive' &&
        values.MainPID === '0',
      'FAST_EXPORT_WRITERS_NOT_STOPPED',
    );
    return { unit, loadState: 'loaded', activeState: 'inactive', mainPid: 0 };
  });
}
export async function mediaPointer(source, root, origins) {
  let candidate;
  try {
    const url = new URL(source, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' && !origins.includes(url.origin))
      return { source, status: 'external', path: source };
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/generated/') || pathname.startsWith('/stickers/builtin/'))
      candidate = resolve(root, 'public', pathname.slice(1));
    else if (isAbsolute(pathname)) candidate = resolve(pathname);
    else return { source, status: 'unsupported_reference' };
    const rel = relative(root, candidate);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
      return { source, status: 'outside_source_root' };
    const stat = await lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) return { source, status: 'unsupported_file' };
    const actual = await realpath(candidate),
      within = relative(root, actual);
    if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within))
      return { source, status: 'outside_source_root' };
    return {
      source,
      status: 'file',
      path: actual,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      archive:
        'media/' +
        createHash('sha256').update(source).digest('hex') +
        extname(actual).toLowerCase(),
    };
  } catch (error) {
    if (error?.code === 'ENOENT')
      return { source, status: 'missing_file', path: candidate ?? null };
    return { source, status: 'unreadable_or_invalid_reference' };
  }
}

export async function exportFastSnapshot({
  dbPath,
  root,
  cutoff,
  frozen = false,
  freezeId = null,
  writerUnits = [],
  confirmedProcessStop = false,
  legacyOrigins = [
    'https://weiban.online',
    'https://www.weiban.online',
    'http://weiban.online',
    'http://www.weiban.online',
    'http://152.136.111.51',
    'https://152.136.111.51',
  ],
  output = process.stdout,
}) {
  need(
    typeof dbPath === 'string' && dbPath && typeof root === 'string' && root,
    'FAST_EXPORT_PATH_REQUIRED',
  );
  cutoff = iso(cutoff);
  root = await realpath(resolve(root));
  need(!output.isTTY, 'FAST_EXPORT_PRIVATE_PIPE_REQUIRED');
  if (Number.isInteger(output.fd)) {
    const stat = fstatSync(output.fd);
    need(stat.isFIFO() || stat.isSocket(), 'FAST_EXPORT_PRIVATE_PIPE_REQUIRED');
  }
  const states = frozen && writerUnits.length ? stopped(writerUnits) : [];
  need(
    !frozen || writerUnits.length > 0 || confirmedProcessStop === true,
    'FAST_EXPORT_REAL_FREEZE_CONFIRMATION_REQUIRED',
  );
  need(
    !frozen || (typeof freezeId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/u.test(freezeId)),
    'FAST_EXPORT_FREEZE_ID_REQUIRED',
  );
  legacyOrigins = legacyOrigins.map((value) => new URL(value).origin);
  const gzip = createGzip({ level: 2 });
  gzip.pipe(output);
  const write = async (table, row) => {
    if (!gzip.write(JSON.stringify({ table, row }) + '\n')) await once(gzip, 'drain');
  };
  const child = spawn('sqlite3', ['-readonly', '-batch', resolve(dbPath)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let childError = null,
    stderrBytes = 0,
    metadataDone = false,
    complete = false,
    totalBytes = 0;
  child.on('error', () => {
    childError = 'FAST_EXPORT_SQLITE_UNAVAILABLE';
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
  });
  const closed = new Promise((resolveClose) => child.once('close', (code) => resolveClose(code)));
  const schema = new Map(),
    allowed = [],
    counts = {},
    refs = new Set();
  let excludedOwners = 0;
  const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
  child.stdin.write(
    ".bail on\n.timeout 5000\nPRAGMA query_only=ON;\nBEGIN;\nSELECT json_object('table','_owner','row',json_object('id',id)) FROM app_users ORDER BY id;\n",
  );
  for (const table of names)
    child.stdin.write(
      `SELECT json_object('table','_schema','row',json_object('table','${table}','column',name)) FROM pragma_table_info('${table}');\n`,
    );
  child.stdin.write("SELECT json_object('table','_metadata_done','row',json_object());\n");
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      totalBytes += Buffer.byteLength(line);
      need(totalBytes <= 512 * 1024 * 1024, 'FAST_EXPORT_SIZE_LIMIT');
      const value = JSON.parse(line),
        { table, row } = value;
      if (table === '_owner') {
        need(UUID.test(row.id), 'FAST_EXPORT_OWNER_INVALID');
        if (isMigrationOwnerPreserved(row.id)) excludedOwners++;
        else allowed.push(row.id);
        continue;
      }
      if (table === '_schema') {
        const columns = schema.get(row.table) ?? new Set();
        columns.add(row.column);
        schema.set(row.table, columns);
        continue;
      }
      if (table === '_metadata_done') {
        need(!metadataDone, 'FAST_EXPORT_METADATA_DUPLICATE');
        metadataDone = true;
        for (const required of names.filter((name) => name !== 'chat_read_cursors'))
          need(schema.has(required), 'FAST_EXPORT_SCHEMA_INCOMPLETE');
        for (const [table, required] of [
          ['app_users', ['id', 'username', 'password_hash', 'created_at']],
          [
            'chat_history',
            ['id', 'user_id', 'created_at', 'deleted_at', 'deletion_scope', 'content'],
          ],
          [
            'group_messages',
            ['id', 'group_id', 'created_at', 'deleted_at', 'deletion_scope', 'content'],
          ],
        ])
          need(
            required.every((column) => schema.get(table).has(column)),
            'FAST_EXPORT_SCHEMA_INCOMPLETE',
          );
        await write('_snapshot', {
          version: 1,
          format: 'fast-cutover-20261109',
          initialCutoff: INITIAL,
          cutoff,
          capturedAt: new Date().toISOString(),
          sourceFrozen: frozen,
          freezeId,
          writerUnits,
          writerStates: states,
          operatorConfirmedProcessStop: confirmedProcessStop,
          freezeCheck: frozen
            ? writerUnits.length
              ? confirmedProcessStop
                ? 'loaded-systemd-units-and-operator-process-stop'
                : 'loaded-systemd-units-stopped'
              : 'operator-confirmed-process-stop'
            : 'live-plan',
          excludedOwners,
        });
        const ids = `SELECT value FROM json_each(${quote(JSON.stringify(allowed))})`;
        const delta = `((julianday(m.created_at)>julianday(${quote(INITIAL)}) AND julianday(m.created_at)<=julianday(${quote(cutoff)})) OR (julianday(m.created_at)<=julianday(${quote(INITIAL)}) AND julianday(m.deleted_at)>julianday(${quote(INITIAL)}) AND julianday(m.deleted_at)<=julianday(${quote(cutoff)})))`;
        for (const table of names) {
          if (!schema.has(table)) continue;
          const cols = schema.get(table),
            pairs = fields[table]
              .flatMap((field) => [quote(field), cols.has(field) ? `m.${field}` : 'NULL'])
              .join(',');
          let where,
            join = '';
          if (table === 'app_users') where = `m.id IN (${ids})`;
          else if (
            table === 'chat_groups' ||
            table === 'user_friends' ||
            table === 'chat_read_cursors'
          )
            where = `m.user_id IN (${ids})`;
          else if (table === 'chat_group_members' || table === 'group_messages') {
            join = ' JOIN chat_groups g ON g.id=m.group_id';
            where = `g.user_id IN (${ids})`;
            if (table === 'group_messages') {
              where += ` AND ${delta}`;
              if (cols.has('user_id'))
                where += ` AND (coalesce(m.user_id,'')='' OR m.user_id IN (${ids}))`;
            }
          } else where = `m.user_id IN (${ids}) AND ${delta}`;
          child.stdin.write(
            `SELECT json_object('table','${table}','row',json_object(${pairs})) FROM ${table} m${join} WHERE ${where} ORDER BY ${cols.has('id') ? 'm.id' : 'm.user_id'};\n`,
          );
        }
        child.stdin.end(
          "SELECT json_object('table','_sqlite_complete','row',json_object());\nROLLBACK;\n",
        );
        continue;
      }
      if (table === '_sqlite_complete') {
        complete = true;
        continue;
      }
      need(names.includes(table), 'FAST_EXPORT_UNEXPECTED_TABLE');
      counts[table] = (counts[table] ?? 0) + 1;
      if (
        ['chat_history', 'group_messages'].includes(table) &&
        !String(row.deleted_at ?? '').trim()
      )
        for (const field of ['media_path', 'audio_url', 'image_url'])
          if (typeof row[field] === 'string' && row[field].trim()) refs.add(row[field].trim());
      await write(table, row);
    }
    need(
      (await closed) === 0 && !childError && !stderrBytes && complete,
      'FAST_EXPORT_SQLITE_FAILED',
    );
    const mediaCounts = {};
    for (const ref of refs) {
      const info = await mediaPointer(ref, root, legacyOrigins);
      mediaCounts[info.status] = (mediaCounts[info.status] ?? 0) + 1;
      await write('_media', info);
    }
    if (frozen && writerUnits.length) stopped(writerUnits);
    await write('_complete', {
      counts,
      mediaCounts,
      excludedOwners,
      sourceFrozen: frozen,
      freezeId,
    });
    gzip.end();
    await once(gzip, 'end');
    return { ok: true, counts, mediaCounts, excludedOwners, sourceFrozen: frozen };
  } catch {
    child.kill();
    gzip.destroy();
    throw new Error(childError ?? 'FAST_EXPORT_FAILED');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map();
  let frozen = false,
    confirmedProcessStop = false;
  try {
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      if (key === '--frozen') {
        frozen = true;
        continue;
      }
      if (key === '--confirmed-process-stop') {
        confirmedProcessStop = true;
        continue;
      }
      need(
        [
          '--db',
          '--root',
          '--cutoff',
          '--freeze-id',
          '--writer-units',
          '--legacy-origins',
        ].includes(key) && process.argv[i + 1],
        'FAST_EXPORT_ARGUMENT_INVALID',
      );
      args.set(key, process.argv[++i]);
    }
    const result = await exportFastSnapshot({
      dbPath: args.get('--db'),
      root: args.get('--root'),
      cutoff: args.get('--cutoff'),
      frozen,
      freezeId: args.get('--freeze-id'),
      confirmedProcessStop,
      writerUnits: (args.get('--writer-units') ?? '').split(',').filter(Boolean),
      legacyOrigins: args.has('--legacy-origins')
        ? args.get('--legacy-origins').split(',').filter(Boolean)
        : undefined,
    });
    process.stderr.write(JSON.stringify(result) + '\n');
  } catch {
    process.stderr.write(JSON.stringify({ ok: false, category: 'FAST_EXPORT_FAILED' }) + '\n');
    process.exitCode = 1;
  }
}
