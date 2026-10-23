#!/usr/bin/env node
/** Read-only, explicitly scoped legacy export. Never load legacy application code. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const PROVIDER_COLUMNS = [
  'id',
  'name',
  'vendor',
  'base_url',
  'api_key',
  'enabled',
  'sort_order',
  'created_at',
  'updated_at',
];
const ENDPOINT_COLUMNS = [
  'id',
  'scene',
  'label',
  'vendor',
  'base_url',
  'api_key',
  'model',
  'enabled',
  'sort_order',
  'created_at',
  'updated_at',
  'provider_id',
  'models_json',
  'vision_direct',
  'capabilities_json',
];
const SCENES = new Set([
  'text',
  'vision',
  'voice_asr',
  'voice_tts',
  'voice_clone',
  'voice_realtime',
]);
const VENDORS = new Set(['mimo', 'openai_compatible', 'dashscope', 'siliconflow']);
const ENV_KEYS = new Set([
  'MIMO_API_KEY',
  'MIMO_BACKUP_API_KEY',
  'MIMO_VISION_API_KEY',
  'MIMO_VISION_BACKUP_API_KEY',
  'MIMO_ASR_API_KEY',
  'MIMO_ASR_BACKUP_API_KEY',
  'MIMO_TTS_API_KEY',
  'MIMO_TTS_BACKUP_API_KEY',
  'MIMO_VOICECLONE_API_KEY',
  'MIMO_VOICECLONE_BACKUP_API_KEY',
  'DASHSCOPE_API_KEY',
  'QWEN_TTS_API_KEY',
  'DEEPSEEK_API_KEY',
]);
const KEY_FILES = ['WEIBAN_DATA_ENCRYPTION_KEY_FILE', 'WEIBAN_DATA_ENCRYPTION_OLD_KEY_FILES'];
class SafeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new SafeFailure(code);
};
function list(value = '') {
  const values = value ? value.split(',') : [];
  if (
    values.length > 200 ||
    values.some((v) => !/^[A-Za-z0-9_.:-]{1,128}$/.test(v)) ||
    new Set(values).size !== values.length
  )
    fail('SCOPE_INVALID');
  return values;
}
function small(value, max = 200) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail('METADATA_INVALID');
  return value;
}
function openDatabase(filename, modulePath) {
  if (!path.isAbsolute(filename) || !fs.statSync(filename).isFile()) fail('DATABASE_INVALID');
  let db;
  if (modulePath) {
    if (!path.isAbsolute(modulePath)) fail('SQLITE_DRIVER_INVALID');
    const metadata = JSON.parse(fs.readFileSync(path.join(modulePath, 'package.json'), 'utf8'));
    if (metadata.name !== 'better-sqlite3') fail('SQLITE_DRIVER_INVALID');
    const Driver = require(modulePath);
    db = new Driver(filename, { readonly: true, fileMustExist: true });
  } else {
    let Driver;
    try {
      Driver = require('node:sqlite').DatabaseSync;
    } catch {
      fail('SQLITE_DRIVER_UNAVAILABLE');
    }
    db = new Driver(filename, { readOnly: true });
  }
  try {
    db.exec('PRAGMA query_only=ON; BEGIN;');
    for (const [table, columns] of [
      ['ai_providers', PROVIDER_COLUMNS],
      ['ai_endpoints', ENDPOINT_COLUMNS],
    ]) {
      const names = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((r) => r.name);
      if (names.length !== columns.length || columns.some((name) => !names.includes(name)))
        fail('SCHEMA_UNSUPPORTED');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function snapshot(db, providerIds, endpointIds) {
  const marks = (ids) => ids.map(() => '?').join(',');
  const providers = providerIds.length
    ? db
        .prepare(
          `SELECT id,name,vendor,base_url,api_key,enabled,sort_order FROM ai_providers WHERE id IN (${marks(providerIds)}) ORDER BY sort_order,id`,
        )
        .all(...providerIds)
    : [];
  if (providers.length !== providerIds.length) fail('SCOPE_NOT_FOUND');
  const where = [],
    args = [];
  if (providerIds.length) {
    where.push(`e.provider_id IN (${marks(providerIds)})`);
    args.push(...providerIds);
  }
  if (endpointIds.length) {
    where.push(`e.id IN (${marks(endpointIds)})`);
    args.push(...endpointIds);
  }
  const endpoints = where.length
    ? db
        .prepare(
          `SELECT e.id,e.scene,e.label,e.model,e.models_json,e.vision_direct,e.enabled,e.sort_order,e.provider_id,
    p.id AS resolved_provider_id,p.enabled AS provider_enabled,
    CASE WHEN e.provider_id<>'' THEN p.name ELSE e.label END AS connection_name,
    CASE WHEN e.provider_id<>'' THEN p.vendor ELSE e.vendor END AS vendor,
    CASE WHEN e.provider_id<>'' THEN p.base_url ELSE e.base_url END AS base_url,
    CASE WHEN e.provider_id<>'' THEN p.api_key ELSE e.api_key END AS secret
    FROM ai_endpoints e LEFT JOIN ai_providers p ON p.id=e.provider_id WHERE ${where.join(' OR ')} ORDER BY e.scene,e.sort_order,e.id`,
        )
        .all(...args)
    : [];
  if (endpoints.length > 1000 || endpointIds.some((id) => !endpoints.some((e) => e.id === id)))
    fail('SCOPE_NOT_FOUND');
  return { providers, endpoints };
}
async function selectedEnv(filename, selected) {
  const values = new Map();
  if (!filename) return values;
  if (!path.isAbsolute(filename)) fail('ENV_FILE_INVALID');
  const allowed = new Set([...selected, ...KEY_FILES]);
  const stream = fs.createReadStream(filename, { encoding: 'utf8' });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let bytes = 0;
  try {
    for await (const line of reader) {
      bytes += Buffer.byteLength(line);
      if (bytes > 1024 * 1024) fail('ENV_FILE_INVALID');
      const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      if (['WEIBAN_DATA_ENCRYPTION_KEY', 'WEIBAN_DATA_ENCRYPTION_OLD_KEYS'].includes(match[1]))
        fail('VAULT_KEY_COLOCATED');
      if (!allowed.has(match[1])) continue;
      if (values.has(match[1])) fail('ENV_DUPLICATE');
      let value = match[2].trim();
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          fail('ENV_VALUE_INVALID');
        }
        if (typeof value !== 'string') fail('ENV_VALUE_INVALID');
      } else if (value.startsWith("'")) {
        if (!value.endsWith("'")) fail('ENV_VALUE_INVALID');
        value = value.slice(1, -1);
      } else value = value.replace(/\s+#.*$/, '').trim();
      values.set(match[1], value);
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return values;
}
function keyring(options, env) {
  const records = new Map();
  function add(raw) {
    const value = raw.trim();
    if (!value) return;
    const key = /^[0-9a-f]{64}$/i.test(value)
      ? Buffer.from(value, 'hex')
      : Buffer.from(value, 'base64url');
    if (key.length !== 32) fail('VAULT_KEY_INVALID');
    const kid = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
    if (records.has(kid) && !crypto.timingSafeEqual(records.get(kid), key))
      fail('VAULT_KEY_INVALID');
    records.set(kid, key);
  }
  function file(filename) {
    if (!path.isAbsolute(filename)) fail('VAULT_KEY_INVALID');
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size > 1024) fail('VAULT_KEY_INVALID');
    add(fs.readFileSync(filename, 'utf8'));
  }
  const currentFile =
    options.vaultKeyFile ||
    process.env.WEIBAN_DATA_ENCRYPTION_KEY_FILE ||
    env.get('WEIBAN_DATA_ENCRYPTION_KEY_FILE');
  if (process.env.WEIBAN_DATA_ENCRYPTION_KEY) add(process.env.WEIBAN_DATA_ENCRYPTION_KEY);
  else if (currentFile) file(currentFile);
  for (const raw of (process.env.WEIBAN_DATA_ENCRYPTION_OLD_KEYS || '').split(',').filter(Boolean))
    add(raw);
  for (const filename of (
    process.env.WEIBAN_DATA_ENCRYPTION_OLD_KEY_FILES ||
    env.get('WEIBAN_DATA_ENCRYPTION_OLD_KEY_FILES') ||
    ''
  )
    .split(path.delimiter)
    .filter(Boolean))
    file(filename);
  return records;
}
function reveal(value, context, keys) {
  if (typeof value !== 'string' || value.length > 64 * 1024) fail('SECRET_INVALID');
  if (!value.startsWith('wbenc:v1:')) {
    if (value.startsWith('wbenc:')) fail('SECRET_FORMAT_UNSUPPORTED');
    return value;
  }
  const parts = value.split(':');
  if (parts.length !== 6 || !/^[0-9a-f]{16}$/.test(parts[2])) fail('SECRET_INVALID');
  const key = keys.get(parts[2]);
  if (!key) fail('VAULT_KEY_UNAVAILABLE');
  try {
    const iv = Buffer.from(parts[3], 'base64url'),
      tag = Buffer.from(parts[4], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) fail('SECRET_INVALID');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('weiban-secret:v1:' + context));
    cipher.setAuthTag(tag);
    return Buffer.concat([
      cipher.update(Buffer.from(parts[5], 'base64url')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    fail('SECRET_AUTHENTICATION_FAILED');
  }
}
function safeUrl(raw, secret) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('UPSTREAM_URL_INVALID');
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    fail('UPSTREAM_URL_INVALID');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    url.protocol !== 'https:' ||
    isIP(host) ||
    host === 'localhost' ||
    /\.(?:local|internal|localhost)$/.test(host) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    /(?:api[-_]?key|token|secret|sk-)/i.test(decoded) ||
    (secret && (raw.includes(secret) || decoded.includes(secret)))
  )
    fail('UPSTREAM_URL_INVALID');
  return url.toString();
}
function recipient(options) {
  if (
    !/^[0-9a-f]{64}$/i.test(options.recipientSha256 || '') ||
    !options.recipientCert ||
    !path.isAbsolute(options.recipientCert)
  )
    fail('RECIPIENT_REQUIRED');
  const stat = fs.statSync(options.recipientCert);
  if (!stat.isFile() || stat.size > 64 * 1024) fail('RECIPIENT_INVALID');
  const data = fs.readFileSync(options.recipientCert);
  if (data.includes(Buffer.from('PRIVATE KEY'))) fail('RECIPIENT_INVALID');
  let cert;
  try {
    cert = new crypto.X509Certificate(data);
  } catch {
    fail('RECIPIENT_INVALID');
  }
  const fingerprint = crypto.createHash('sha256').update(cert.raw).digest('hex');
  if (
    !crypto.timingSafeEqual(
      Buffer.from(fingerprint),
      Buffer.from(options.recipientSha256.toLowerCase()),
    )
  )
    fail('RECIPIENT_MISMATCH');
  if (
    cert.publicKey.asymmetricKeyType !== 'rsa' ||
    cert.publicKey.asymmetricKeyDetails.modulusLength < 3072 ||
    Date.parse(cert.validFrom) > Date.now() ||
    Date.parse(cert.validTo) <= Date.now() + 600000
  )
    fail('RECIPIENT_INVALID');
  return fingerprint;
}
function childEnv() {
  return Object.fromEntries(
    ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
}
function requireCms(options) {
  const binary = options.opensslBin || process.env.OPENSSL_BIN || 'openssl';
  const env = childEnv();
  const version = spawnSync(binary, ['version'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16384,
  });
  if (version.status !== 0 || !/^OpenSSL\s+(?:[3-9]\.|1\.1\.1)/.test(version.stdout || ''))
    fail('CMS_UNAVAILABLE');
  return { binary, env };
}
function encryptCms(payload, options, { binary, env }) {
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > 2 * 1024 * 1024) fail('EXPORT_TOO_LARGE');
  try {
    const result = spawnSync(
      binary,
      [
        'cms',
        '-encrypt',
        '-aes-256-gcm',
        '-binary',
        '-outform',
        'DER',
        '-recip',
        options.recipientCert,
        '-keyopt',
        'rsa_padding_mode:oaep',
        '-keyopt',
        'rsa_oaep_md:sha256',
        '-keyopt',
        'rsa_mgf1_md:sha256',
      ],
      { env, input: plain, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0 || !Buffer.isBuffer(result.stdout) || !result.stdout.length)
      fail('CMS_ENCRYPTION_FAILED');
    return result.stdout;
  } finally {
    plain.fill(0);
  }
}
async function writeCipher(filename, cipher) {
  if (filename === '-') {
    await new Promise((resolve, reject) => {
      process.stdout.write(cipher, (error) => (error ? reject(error) : resolve()));
    });
    return;
  }
  if (!filename || !path.isAbsolute(filename)) fail('OUTPUT_REQUIRED');
  const parent = path.dirname(filename),
    real = fs.realpathSync(parent);
  const equal =
    process.platform === 'win32' ? parent.toLowerCase() === real.toLowerCase() : parent === real;
  if (!equal) fail('OUTPUT_PATH_INVALID');
  const fd = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, cipher);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export async function runExport(options) {
  const providerIds = list(options.providerIds),
    endpointIds = list(options.endpointIds),
    envNames = list(options.envKeys);
  if (envNames.some((name) => !ENV_KEYS.has(name))) fail('ENV_KEY_NOT_ALLOWED');
  if (options.dryRun) {
    const db = openDatabase(options.db, options.sqliteModule);
    try {
      return {
        ok: true,
        dryRun: true,
        providers: db.prepare('SELECT COUNT(id) AS n FROM ai_providers').get().n,
        endpoints: db.prepare('SELECT COUNT(id) AS n FROM ai_endpoints').get().n,
        secretsRead: false,
        databaseReadOnly: true,
      };
    } finally {
      db.close();
    }
  }
  if (!providerIds.length && !endpointIds.length && !envNames.length) fail('SCOPE_REQUIRED');
  const fingerprint = recipient(options);
  if (!options.output) fail('OUTPUT_REQUIRED');
  const cms = requireCms(options);
  const env = await selectedEnv(options.envFile, envNames);
  const keys = keyring(options, env);
  let db, cipher;
  try {
    db = openDatabase(options.db, options.sqliteModule);
    const source = snapshot(db, providerIds, endpointIds);
    db.close();
    db = null; // Release the old read transaction before cryptography or a slow output pipe.
    const accounts = new Map(),
      endpoints = [];
    function account(id, context, name, vendor, baseUrl, stored, enabled, order) {
      if (accounts.has(id)) return;
      if (!VENDORS.has(vendor)) fail('VENDOR_UNSUPPORTED');
      const apiKey = reveal(stored || '', context, keys);
      accounts.set(id, {
        sourceId: id,
        name: small(name),
        vendor,
        baseUrl: safeUrl(baseUrl, apiKey),
        apiKey,
        sourceEnabled: !!enabled,
        sourceOrder: order,
        targetEnabled: false,
      });
    }
    for (const p of source.providers)
      account(
        'provider:' + p.id,
        `ai_provider:${p.id}:api_key`,
        p.name,
        p.vendor,
        p.base_url,
        p.api_key,
        p.enabled,
        p.sort_order,
      );
    for (const e of source.endpoints) {
      if (!SCENES.has(e.scene)) fail('SCENE_UNSUPPORTED');
      if (e.provider_id && e.resolved_provider_id !== e.provider_id)
        fail('PROVIDER_REFERENCE_INVALID');
      const ref = e.provider_id ? 'provider:' + e.provider_id : 'endpoint:' + e.id;
      account(
        ref,
        e.provider_id ? `ai_provider:${e.provider_id}:api_key` : `ai_endpoint:${e.id}:api_key`,
        e.connection_name,
        e.vendor,
        e.base_url,
        e.secret,
        e.provider_id ? e.provider_enabled : e.enabled,
        e.sort_order,
      );
      let models;
      try {
        models = e.models_json ? JSON.parse(e.models_json) : [];
      } catch {
        fail('MODEL_METADATA_INVALID');
      }
      if (!Array.isArray(models) || models.length > 16) fail('MODEL_METADATA_INVALID');
      endpoints.push({
        sourceId: small(e.id, 128),
        scene: e.scene,
        label: small(e.label),
        model: small(e.model),
        modelPool: models.map((model) => small(model)),
        visionDirect: !!e.vision_direct,
        sourceEnabled: !!e.enabled && (!e.provider_id || !!e.provider_enabled),
        sourceOrder: e.sort_order,
        connectionRef: ref,
        targetEnabled: false,
      });
    }
    const credentials = envNames.map((name) => {
      const stored = process.env[name] ?? env.get(name);
      if (!stored) fail('ENV_KEY_UNAVAILABLE');
      return {
        sourceName: name,
        apiKey: reveal(stored, 'env:' + name, keys),
        targetEnabled: false,
      };
    });
    const now = Date.now();
    const payload = {
      format: 'weiban-legacy-upstreams-v1',
      exportId: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
      recipientSha256: fingerprint,
      targetPolicy: 'disabled-pending-validation',
      accounts: [...accounts.values()],
      endpoints,
      envCredentials: credentials,
    };
    cipher = encryptCms(payload, options, cms);
    await writeCipher(options.output, cipher);
    return {
      ok: true,
      dryRun: false,
      databaseReadOnly: true,
      accounts: accounts.size,
      endpoints: endpoints.length,
      envCredentials: credentials.length,
      ciphertextBytes: cipher.length,
      ciphertextSha256: crypto.createHash('sha256').update(cipher).digest('hex'),
    };
  } finally {
    db?.close();
    for (const key of keys.values()) key.fill(0);
    cipher?.fill(0);
  }
}
function parse(argv) {
  const names = {
    '--db': 'db',
    '--provider-ids': 'providerIds',
    '--endpoint-ids': 'endpointIds',
    '--env-keys': 'envKeys',
    '--legacy-env-file': 'envFile',
    '--vault-key-file': 'vaultKeyFile',
    '--recipient-cert': 'recipientCert',
    '--recipient-sha256': 'recipientSha256',
    '--output': 'output',
    '--sqlite-module': 'sqliteModule',
    '--openssl-bin': 'opensslBin',
  };
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    const name = names[argv[i]];
    if (!name || out[name] !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--'))
      fail('ARGUMENT_INVALID');
    out[name] = argv[++i];
  }
  if (!out.db) fail('DATABASE_REQUIRED');
  return out;
}
const stdinEntry =
  process.argv[1] === '-' && /^\[eval\d+\]$/.test(path.basename(fileURLToPath(import.meta.url)));
if (
  stdinEntry ||
  (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
) {
  try {
    const options = parse(process.argv.slice(2));
    const result = await runExport(options);
    (options.output === '-' && !options.dryRun ? process.stderr : process.stdout).write(
      JSON.stringify(result) + '\n',
    );
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        code: error instanceof SafeFailure ? error.code : 'EXPORT_FAILED',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
