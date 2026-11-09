'use strict';
// After deployment only: signed read-only status for approved mappings. No inbox/outbox/model use.
const fs = require('node:fs');
const path = require('node:path');
const { loadLegacyEnvironment } = require('./export-old.cjs');
const { parseMap, deriveKey, sign, sha } = require('./legacy_channel_relay.cjs');

async function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) options.set(args[i], args[i + 1]);
  const root = path.resolve(options.get('--root') || '/opt/weiban-server');
  const env = loadLegacyEnvironment(root, options.get('--runtime-pid'));
  const maps = parseMap(
    JSON.parse(fs.readFileSync(options.get('--map') || env.LEGACY_CHANNEL_RELAY_MAP_FILE, 'utf8')),
  );
  const origin = new URL(options.get('--origin') || env.LEGACY_CHANNEL_RELAY_BASE_URL);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  )
    throw new Error('HTTPS_ORIGIN_REQUIRED');
  const jwt = require(path.join(root, 'lib/secret_vault.js')).revealEnvValue(
    'JWT_SECRET',
    env.JWT_SECRET,
    env,
  );
  const Driver = require(path.join(root, 'node_modules/better-sqlite3'));
  const db = new Driver(path.join(root, 'weiban.db'), { readonly: true, fileMustExist: true });
  const statuses = {};
  let ok = 0;
  try {
    for (const m of maps) {
      const keyColumn = m.channel === 'wechat' ? 'user_id' : 'id';
      const peerColumn =
        m.channel === 'wechat' ? 'ilink_user_id' : m.channel === 'weibo' ? 'weibo_uid' : 'qq_uid';
      const row = db
        .prepare(
          `SELECT user_id,generation,status,persona_name,${peerColumn} AS peer FROM ${m.channel}_bindings WHERE ${keyColumn}=?`,
        )
        .get(m.legacyBindingId);
      if (
        !row ||
        row.status !== 'active' ||
        row.user_id !== m.userId ||
        Number(row.generation) !== m.generation ||
        sha(String(row.peer || '').trim()) !== m.peerHash ||
        sha(String(row.persona_name || '').trim()) !== m.personaHash
      ) {
        statuses.local_mapping_changed = (statuses.local_mapping_changed || 0) + 1;
        continue;
      }
      const key = deriveKey(jwt, m.id);
      try {
        const response = await fetch(`${origin.origin}/api/v1/internal/channels/legacy/${m.id}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sign(key, m.id, { op: 'status', generation: m.generation })),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        });
        statuses[response.status] = (statuses[response.status] || 0) + 1;
        if (response.ok) {
          const result = await response.json();
          if (result.enabled === true && result.generation === m.generation) ok++;
        }
      } catch {
        statuses.transport = (statuses.transport || 0) + 1;
      } finally {
        key.fill(0);
      }
    }
  } finally {
    db.close();
  }
  return { mappings: maps.length, enabledAndAuthorized: ok, statuses, sentMessages: 0 };
}

if (require.main === module)
  main(process.argv.slice(2))
    .then((result) => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(() => {
      process.stderr.write('LEGACY_RELAY_STATUS_PROBE_FAILED\n');
      process.exitCode = 1;
    });
module.exports = { main };
