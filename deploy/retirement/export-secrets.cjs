'use strict';
// Old host: read-only, no application bootstrap. Only ciphertext leaves stdout.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = '/opt/weiban-server';
const requireOld = createRequire(root + '/package.json');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const pub = crypto.createPublicKey(input.publicKey);
if (
  pub.asymmetricKeyType !== 'rsa' ||
  pub.asymmetricKeyDetails.modulusLength < 3072 ||
  digest(pub.export({ type: 'spki', format: 'der' })) !== input.publicKeyHash
)
  throw new Error('RECIPIENT_INVALID');
let payload;
if (input.kind === 'archive') {
  const declared = requireOld('dotenv').parse(fs.readFileSync(root + '/.env'));
  const application = JSON.parse(
    execFileSync('pm2', ['jlist'], { stdio: ['ignore', 'pipe', 'pipe'] }),
  ).find((p) => p.name === 'weiban-server');
  if (!application?.pid) throw new Error('OLD_RUNTIME_MISSING');
  const runtime = {};
  for (const item of fs.readFileSync(`/proc/${application.pid}/environ`, 'utf8').split('\0')) {
    const i = item.indexOf('=');
    if (i > 0) runtime[item.slice(0, i)] = item.slice(i + 1);
  }
  const environment = Object.fromEntries(
    Object.keys(declared).map((name) => [name, runtime[name] ?? declared[name]]),
  );
  const vault = requireOld('./lib/secret_vault');
  const effective = { ...declared, ...runtime };
  const ring = vault.loadKeyring(effective);
  if (!ring.current || !vault.revealEnvValue('ADMIN_TOKEN', effective.ADMIN_TOKEN, effective))
    throw new Error('ARCHIVE_AUTH_UNAVAILABLE');
  for (const name of ['ADMIN_TOKEN', 'ADMIN_SESSION_SECRET', 'JWT_SECRET'])
    if (effective[name]) environment[name] = effective[name];
  payload = {
    kind: 'archive',
    version: 1,
    environment,
    vaultKey: ring.current.key.toString('hex'),
    oldVaultKeys: [...ring.byId.values()]
      .filter((r) => r.kid !== ring.current.kid)
      .map((r) => r.key.toString('hex')),
    createdAt: new Date().toISOString(),
  };
} else if (input.kind === 'wechat') {
  const application = JSON.parse(
    execFileSync('pm2', ['jlist'], { stdio: ['ignore', 'pipe', 'pipe'] }),
  ).find((p) => p.name === 'weiban-server');
  const runtime = application?.pm2_env || {};
  const sourcePollingStopped =
    runtime.status !== 'online' ||
    (String(runtime.WECHAT_CHANNEL_ENABLED ?? runtime.env?.WECHAT_CHANNEL_ENABLED) === '0' &&
      String(runtime.LEGACY_CHANNEL_RELAY_ENABLED ?? runtime.env?.LEGACY_CHANNEL_RELAY_ENABLED) ===
        '0');
  const Sqlite = requireOld('better-sqlite3');
  const db = new Sqlite(root + '/weiban.db', { readonly: true, fileMustExist: true });
  const mappings = JSON.parse(
    fs.readFileSync(root + '/private/legacy-channel-relay-map.json', 'utf8'),
  ).bindings;
  const entries = [];
  let pendingInbox = 0;
  let pendingDeliveries = 0;
  try {
    db.exec('BEGIN');
    for (const m of mappings) {
      if (m.channel !== 'wechat') throw new Error('UNEXPECTED_CHANNEL');
      pendingInbox += db
        .prepare("SELECT count(*) AS n FROM wechat_inbox WHERE job_id=? AND status='received'")
        .get(`lr:${m.id}`).n;
      pendingDeliveries += db
        .prepare(
          "SELECT count(*) AS n FROM wechat_deliveries WHERE user_id=? AND job_id LIKE 'lrout-%' AND status NOT IN ('submitted','sent','skipped','failed')",
        )
        .get(m.userId).n;
      const row = db
        .prepare('SELECT * FROM wechat_bindings WHERE user_id=?')
        .get(m.legacyBindingId);
      if (!row || row.status !== 'active') {
        entries.push({
          legacyId: m.id,
          userId: m.userId,
          characterId: m.characterId,
          conversationId: m.conversationId,
          needsRebind: true,
          sourceStatus: row?.status || 'missing',
        });
        continue;
      }
      if (
        row.user_id !== m.userId ||
        row.generation !== m.generation ||
        digest(row.ilink_user_id) !== m.peerHash ||
        digest(row.persona_name) !== m.personaHash ||
        !row.bot_token ||
        String(row.bot_token).startsWith('wbenc:')
      )
        throw new Error('LEGACY_BINDING_CHANGED');
      entries.push({
        legacyId: m.id,
        userId: m.userId,
        characterId: m.characterId,
        conversationId: m.conversationId,
        generation: m.generation,
        peerHash: m.peerHash,
        personaHash: m.personaHash,
        needsRebind: false,
        accountId: row.ilink_user_id,
        botId: row.bot_id,
        botToken: row.bot_token,
        baseUrl: row.base_url,
        cursor: row.cursor,
        contextToken: row.last_context_token,
        boundAt: row.created_at,
        lastPollAt: row.last_poll_at,
        sourceUpdatedAt: row.updated_at,
      });
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  payload = {
    kind: 'wechat',
    version: 1,
    createdAt: new Date().toISOString(),
    sourcePollingStopped,
    pendingInbox,
    pendingDeliveries,
    entries,
  };
} else throw new Error('EXPORT_KIND_INVALID');
const key = crypto.randomBytes(32),
  iv = crypto.randomBytes(12);
const plain = Buffer.from(JSON.stringify(payload));
try {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('weiban-retirement-export-v1'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  process.stdout.write(
    JSON.stringify({
      version: 1,
      wrappedKey: crypto
        .publicEncrypt(
          { key: pub, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
          key,
        )
        .toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      body: body.toString('base64'),
    }),
  );
} finally {
  key.fill(0);
  plain.fill(0);
}
