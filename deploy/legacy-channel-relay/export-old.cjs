'use strict';
// Read-only metadata export. No chat, provider credentials, model calls or application bootstrap.
// stdout is counts/hashes only. Derived authentication material goes only into an encrypted file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { deriveKey, sha } = require('./legacy_channel_relay.cjs');
const preservedOwners = new Set(require('./preservation-policy.json').userIdSha256);

function loadLegacyEnvironment(root, runtimePid) {
  const declared = require(path.join(root, 'node_modules/dotenv')).parse(
    fs.readFileSync(path.join(root, '.env')),
  );
  const runtime = {};
  if (runtimePid) {
    if (!/^[1-9]\d*$/.test(String(runtimePid))) throw new Error('RUNTIME_PID_INVALID');
    for (const entry of fs.readFileSync(`/proc/${runtimePid}/environ`, 'utf8').split('\0')) {
      const separator = entry.indexOf('=');
      if (separator > 0) runtime[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
  }
  return { ...declared, ...process.env, ...runtime };
}

function bindingId(channel, oldId, generation) {
  const bytes = crypto
    .createHash('sha256')
    .update(`weiban-legacy-binding-v1\0${channel}\0${oldId}\0${generation}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function encryptPayload(payload, publicKey) {
  const key = crypto.randomBytes(32),
    iv = crypto.randomBytes(12);
  const plain = Buffer.from(JSON.stringify(payload));
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('weiban-legacy-channel-export-v1'));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      version: 1,
      wrappedKey: crypto
        .publicEncrypt(
          { key: publicKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
          key,
        )
        .toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    };
  } finally {
    key.fill(0);
    plain.fill(0);
  }
}

function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) options.set(args[i], args[i + 1]);
  const root = path.resolve(options.get('--root') || '/opt/weiban-server');
  const recipientPath = options.get('--recipient-public-key'),
    expected = options.get('--recipient-sha256'),
    output = options.get('--output');
  if (
    !recipientPath ||
    !/^[0-9a-f]{64}$/.test(expected || '') ||
    !output ||
    !path.isAbsolute(output)
  )
    throw new Error('EXPORT_ARGUMENTS_INVALID');
  const pub = crypto.createPublicKey(fs.readFileSync(recipientPath));
  if (
    pub.asymmetricKeyType !== 'rsa' ||
    pub.asymmetricKeyDetails.modulusLength < 3072 ||
    sha(pub.export({ type: 'spki', format: 'der' })) !== expected
  )
    throw new Error('RECIPIENT_INVALID');
  const env = loadLegacyEnvironment(root, options.get('--runtime-pid'));
  const vault = require(path.join(root, 'lib/secret_vault.js'));
  const jwt = vault.revealEnvValue('JWT_SECRET', env.JWT_SECRET, env);
  const Driver = require(path.join(root, 'node_modules/better-sqlite3'));
  const db = new Driver(path.join(root, 'weiban.db'), { readonly: true, fileMustExist: true });
  const records = [];
  let excludedWeibo = 0,
    excludedProtected = 0;
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const characterNames = new Map();
    for (const character of db
      .prepare('SELECT id,display_name,canonical_name,aliases_json FROM characters_v2')
      .all()) {
      let aliases;
      try {
        aliases = JSON.parse(character.aliases_json || '[]');
      } catch {
        aliases = [];
      }
      for (const name of [
        character.display_name,
        character.canonical_name,
        ...(Array.isArray(aliases) ? aliases : []),
      ]) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const existing = characterNames.get(name.trim()) || new Set();
        existing.add(character.id);
        characterNames.set(name.trim(), existing);
      }
    }
    for (const channel of ['wechat', 'weibo', 'qq']) {
      if (channel === 'weibo') {
        excludedWeibo = db
          .prepare("SELECT count(*) AS n FROM weibo_bindings WHERE status='active'")
          .get().n;
        continue;
      }
      const idColumn = channel === 'wechat' ? 'user_id' : 'id';
      const peerColumn =
        channel === 'wechat' ? 'ilink_user_id' : channel === 'weibo' ? 'weibo_uid' : 'qq_uid';
      const rows = db
        .prepare(
          `SELECT ${idColumn} AS old_id,user_id,generation,persona_name,${peerColumn} AS peer FROM ${channel}_bindings WHERE status='active' ORDER BY ${idColumn}`,
        )
        .all();
      for (const row of rows) {
        if (preservedOwners.has(sha('user:' + String(row.user_id).trim().toLowerCase()))) {
          excludedProtected++;
          continue;
        }
        const characterIds = [...(characterNames.get(String(row.persona_name || '').trim()) || [])];
        const id = bindingId(channel, row.old_id, row.generation),
          key = deriveKey(jwt, id);
        try {
          records.push({
            id,
            channel,
            legacyBindingId: row.old_id,
            generation: row.generation,
            userId: row.user_id,
            sourceUserActive:
              db.prepare('SELECT status FROM app_users WHERE id=?').get(row.user_id)?.status ===
              'active',
            sourceCharacterId: characterIds.length === 1 ? characterIds[0] : null,
            personaName: String(row.persona_name || '').trim(),
            personaHash: sha(String(row.persona_name || '').trim()),
            peerHash: row.peer && String(row.peer).trim() ? sha(String(row.peer).trim()) : null,
            authKey: key.toString('base64'),
          });
        } finally {
          key.fill(0);
        }
      }
    }
    db.exec('ROLLBACK');
  } finally {
    db.close();
  }
  const encrypted = Buffer.from(
    JSON.stringify(
      encryptPayload({ version: 1, bindings: records, excludedWeibo, excludedProtected }, pub),
    ),
  );
  fs.writeFileSync(output, encrypted, { mode: 0o600, flag: 'wx' });
  const counts = Object.fromEntries(
    ['wechat', 'weibo', 'qq'].map((channel) => [
      channel,
      records.filter((r) => r.channel === channel).length,
    ]),
  );
  return {
    bindings: records.length,
    excludedWeibo,
    excludedProtected,
    counts,
    unconfirmedPeers: records.filter((r) => !r.peerHash).length,
    ciphertextSha256: sha(encrypted),
  };
}

module.exports = { bindingId, encryptPayload, loadLegacyEnvironment, main };
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n');
  } catch {
    process.stderr.write('LEGACY_RELAY_EXPORT_FAILED\n');
    process.exitCode = 1;
  }
}
