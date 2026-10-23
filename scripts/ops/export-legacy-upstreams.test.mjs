import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// All keys, identities, database rows and certificates here are synthetic test data.
const cli = fileURLToPath(new URL('./export-legacy-upstreams.mjs', import.meta.url));
const openssl = process.env.OPENSSL_BIN || 'openssl';
const KEY = Buffer.alloc(32, 7);
const PROVIDER_SECRET = 'FAKE_PROVIDER_SECRET_FOR_OFFLINE_TEST_ONLY';
const ENDPOINT_SECRET = 'FAKE_ENDPOINT_SECRET_FOR_OFFLINE_TEST_ONLY';
const ENV_SECRET = 'FAKE_ENV_SECRET_FOR_OFFLINE_TEST_ONLY';
const SHADOW = 'FAKE_SHADOW_KEY_MUST_NOT_BE_EXPORTED';
const PRIVATE_DATA = 'FAKE_PRIVATE_VOICE_AND_CHAT_MUST_NOT_BE_READ';
const SYSTEM_SECRET = 'FAKE_JWT_PAYMENT_SECRET_MUST_NOT_BE_EXPORTED';
const childEnv = Object.fromEntries(
  ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
childEnv.OPENSSL_BIN = openssl;
let root,
  cert,
  privateKey,
  wrongKey,
  fingerprint,
  count = 0;
function command(args) {
  return spawnSync(openssl, args, {
    env: childEnv,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
}
function seal(value, context, key = KEY) {
  const kid = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('weiban-secret:v1:' + context));
  const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
  return [
    'wbenc',
    'v1',
    kid,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    bytes.toString('base64url'),
  ].join(':');
}
function digest(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function fixture() {
  const dir = path.join(root, 'fixture-' + ++count);
  fs.mkdirSync(dir);
  const dbPath = path.join(dir, 'legacy.db'),
    envPath = path.join(dir, 'legacy.env'),
    keyPath = path.join(dir, 'master.key');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE ai_providers(id TEXT PRIMARY KEY,name TEXT,vendor TEXT,base_url TEXT,api_key TEXT,enabled INTEGER,sort_order INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE ai_endpoints(id TEXT PRIMARY KEY,scene TEXT,label TEXT,vendor TEXT,base_url TEXT,api_key TEXT,model TEXT,enabled INTEGER,sort_order INTEGER,created_at TEXT,updated_at TEXT,provider_id TEXT,models_json TEXT,vision_direct INTEGER,capabilities_json TEXT);
    CREATE TABLE private_voice_bindings(id TEXT,voice_id TEXT); CREATE TABLE private_chats(body TEXT);`);
  db.prepare('INSERT INTO ai_providers VALUES(?,?,?,?,?,?,?,?,?)').run(
    'p',
    '仅合成提供商',
    'dashscope',
    'https://voice.example.invalid/api/v1',
    seal(PROVIDER_SECRET, 'ai_provider:p:api_key'),
    1,
    3,
    '2026-01-01',
    '2026-01-01',
  );
  const insert = db.prepare('INSERT INTO ai_endpoints VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run(
    'e',
    'voice_tts',
    '合成端点',
    'mimo',
    'https://shadow.example.invalid/?token=DO_NOT_COPY',
    SHADOW,
    'qwen-audio-3.0-tts-plus',
    1,
    2,
    '',
    '',
    'p',
    '["fallback-model"]',
    0,
    '{"voice_id":"DO_NOT_COPY"}',
  );
  insert.run(
    'standalone',
    'voice_asr',
    '合成ASR',
    'siliconflow',
    'https://asr.example.invalid/v1',
    seal(ENDPOINT_SECRET, 'ai_endpoint:standalone:api_key'),
    'FunAudioLLM/SenseVoiceSmall',
    1,
    0,
    '',
    '',
    '',
    '[]',
    0,
    '{}',
  );
  db.prepare('INSERT INTO private_voice_bindings VALUES(?,?)').run('private', PRIVATE_DATA);
  db.prepare('INSERT INTO private_chats VALUES(?)').run(PRIVATE_DATA);
  db.close();
  fs.writeFileSync(keyPath, KEY.toString('hex'), { mode: 0o600 });
  fs.writeFileSync(
    envPath,
    `WEIBAN_DATA_ENCRYPTION_KEY_FILE=${JSON.stringify(keyPath)}\nMIMO_TTS_API_KEY=${seal(ENV_SECRET, 'env:MIMO_TTS_API_KEY')}\nJWT_SECRET=${SYSTEM_SECRET}\nALIPAY_PRIVATE_KEY=${SYSTEM_SECRET}\n`,
  );
  return { dir, dbPath, envPath, keyPath, output: path.join(dir, 'sealed.cms') };
}
function invoke(f, extra = [], base = true) {
  const args = [cli, '--db', f.dbPath];
  if (base)
    args.push(
      '--provider-ids',
      'p',
      '--endpoint-ids',
      'standalone',
      '--legacy-env-file',
      f.envPath,
      '--env-keys',
      'MIMO_TTS_API_KEY',
      '--recipient-cert',
      cert,
      '--recipient-sha256',
      fingerprint,
      '--output',
      f.output,
    );
  const result = spawnSync(process.execPath, ['--no-warnings', ...args, ...extra], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  for (const value of [
    PROVIDER_SECRET,
    ENDPOINT_SECRET,
    ENV_SECRET,
    SHADOW,
    PRIVATE_DATA,
    SYSTEM_SECRET,
    KEY.toString('hex'),
  ]) {
    assert.equal(
      (result.stdout || '').includes(value),
      false,
      'stdout must not contain synthetic secret',
    );
    assert.equal(
      (result.stderr || '').includes(value),
      false,
      'stderr must not contain synthetic secret',
    );
  }
  return result;
}
function decode(output, key = privateKey) {
  return command([
    'cms',
    '-decrypt',
    '-binary',
    '-inform',
    'DER',
    '-in',
    output,
    '-recip',
    cert,
    '-inkey',
    key,
  ]);
}
function failure(result, code) {
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stderr.trim());
  assert.equal(report.code, code);
  assert.equal(result.stdout, '');
}
before(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'weiban-legacy-export-test-')));
  privateKey = path.join(root, 'synthetic-receiver.key');
  cert = path.join(root, 'receiver.crt');
  const generated = command([
    'req',
    '-x509',
    '-newkey',
    'rsa:3072',
    '-nodes',
    '-keyout',
    privateKey,
    '-out',
    cert,
    '-sha256',
    '-days',
    '1',
    '-subj',
    '/CN=synthetic-legacy-export-test',
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  fingerprint = crypto
    .createHash('sha256')
    .update(new crypto.X509Certificate(fs.readFileSync(cert)).raw)
    .digest('hex');
  wrongKey = path.join(root, 'synthetic-wrong.key');
  const wrong = command([
    'genpkey',
    '-algorithm',
    'RSA',
    '-pkeyopt',
    'rsa_keygen_bits:3072',
    '-out',
    wrongKey,
  ]);
  assert.equal(wrong.status, 0, wrong.stderr);
});
after(() => {
  if (!root) return;
  const resolved = fs.realpathSync(root);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('weiban-legacy-export-test-'));
  assert.notEqual(resolved, fs.realpathSync(os.tmpdir()));
  fs.rmSync(resolved, { recursive: true, force: true });
});

test('dry run reads schema/counts only, without a certificate, environment or master key', () => {
  const f = fixture(),
    before = digest(f.dbPath);
  const result = invoke(
    f,
    ['--dry-run', '--legacy-env-file', path.join(f.dir, 'missing.env')],
    false,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    dryRun: true,
    providers: 1,
    endpoints: 2,
    secretsRead: false,
    databaseReadOnly: true,
  });
  assert.equal(digest(f.dbPath), before);
  assert.equal(fs.existsSync(f.output), false);
});
test('CMS round trip uses provider credentials and URLs, excludes private data, and leaves source files unchanged', () => {
  const f = fixture(),
    before = [f.dbPath, f.envPath, f.keyPath].map(digest);
  const result = invoke(f);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.accounts, 2);
  assert.equal(summary.endpoints, 2);
  assert.equal(summary.envCredentials, 1);
  assert.equal(summary.ciphertextSha256, digest(f.output));
  const decoded = decode(f.output);
  assert.equal(decoded.status, 0, decoded.stderr);
  const payload = JSON.parse(decoded.stdout);
  assert.equal(payload.format, 'weiban-legacy-upstreams-v1');
  assert.equal(payload.recipientSha256, fingerprint);
  assert.equal(payload.accounts.find((a) => a.sourceId === 'provider:p').apiKey, PROVIDER_SECRET);
  assert.equal(
    payload.accounts.find((a) => a.sourceId === 'provider:p').baseUrl,
    'https://voice.example.invalid/api/v1',
  );
  assert.equal(payload.accounts.find((a) => a.sourceId === 'provider:p').vendor, 'dashscope');
  assert.equal(
    payload.accounts.find((a) => a.sourceId === 'endpoint:standalone').apiKey,
    ENDPOINT_SECRET,
  );
  assert.equal(payload.envCredentials[0].apiKey, ENV_SECRET);
  assert.ok(payload.accounts.every((a) => a.targetEnabled === false));
  assert.ok(payload.endpoints.every((e) => e.targetEnabled === false));
  for (const value of [SHADOW, PRIVATE_DATA, SYSTEM_SECRET, KEY.toString('hex'), 'DO_NOT_COPY'])
    assert.equal(decoded.stdout.includes(value), false);
  assert.deepEqual([f.dbPath, f.envPath, f.keyPath].map(digest), before);
  assert.deepEqual(fs.readdirSync(f.dir).sort(), [
    'legacy.db',
    'legacy.env',
    'master.key',
    'sealed.cms',
  ]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.output).mode & 0o777, 0o600);
  const format = command(['cms', '-cmsout', '-print', '-inform', 'DER', '-in', f.output]);
  assert.equal(format.status, 0);
  assert.match(format.stdout, /authEnvelopedData/);
  assert.match(format.stdout, /aes-256-gcm/);
  assert.match(format.stdout, /rsaesOaep/);
});
test('wrong pinned recipient is rejected before secret/environment access', () => {
  const f = fixture();
  const result = invoke(
    f,
    [
      '--provider-ids',
      'p',
      '--legacy-env-file',
      path.join(f.dir, 'missing.env'),
      '--recipient-cert',
      cert,
      '--recipient-sha256',
      '0'.repeat(64),
      '--output',
      f.output,
    ],
    false,
  );
  failure(result, 'RECIPIENT_MISMATCH');
  assert.equal(fs.existsSync(f.output), false);
});
test('CMS rejects another receiver and modified authenticated ciphertext', () => {
  const f = fixture();
  assert.equal(invoke(f).status, 0);
  assert.notEqual(decode(f.output, wrongKey).status, 0);
  const bytes = fs.readFileSync(f.output);
  bytes[bytes.length - 1] ^= 1;
  const corrupt = path.join(f.dir, 'tampered.cms');
  fs.writeFileSync(corrupt, bytes);
  assert.notEqual(decode(corrupt).status, 0);
});
test('incorrect old AAD fails with a fixed error, no raw exception or secret', () => {
  const f = fixture(),
    db = new DatabaseSync(f.dbPath);
  db.prepare('UPDATE ai_providers SET api_key=? WHERE id=?').run(
    seal(PROVIDER_SECRET, 'ai_provider:wrong:api_key'),
    'p',
  );
  db.close();
  const before = digest(f.dbPath);
  failure(invoke(f), 'SECRET_AUTHENTICATION_FAILED');
  assert.equal(digest(f.dbPath), before);
  assert.equal(fs.existsSync(f.output), false);
});
test('unapproved environment variables, unknown schema and orphan provider references fail closed', () => {
  const f = fixture();
  failure(invoke(f, ['--env-keys', 'JWT_SECRET'], false), 'ENV_KEY_NOT_ALLOWED');
  const db = new DatabaseSync(f.dbPath);
  db.prepare('UPDATE ai_endpoints SET provider_id=? WHERE id=?').run('missing', 'e');
  db.close();
  failure(
    invoke(
      f,
      [
        '--endpoint-ids',
        'e',
        '--legacy-env-file',
        f.envPath,
        '--recipient-cert',
        cert,
        '--recipient-sha256',
        fingerprint,
        '--output',
        f.output,
      ],
      false,
    ),
    'PROVIDER_REFERENCE_INVALID',
  );
  const changed = new DatabaseSync(f.dbPath);
  changed.exec('ALTER TABLE ai_providers ADD COLUMN unknown_override TEXT');
  changed.close();
  failure(invoke(f, ['--dry-run'], false), 'SCHEMA_UNSUPPORTED');
});
test('URLs containing credentials/query tokens or private IP literals are never silently sanitized', () => {
  for (const url of [
    'https://voice.example.invalid/?api_key=' + PROVIDER_SECRET,
    'https://user:pass@voice.example.invalid/v1',
    'https://127.0.0.1/v1',
  ]) {
    const f = fixture(),
      db = new DatabaseSync(f.dbPath);
    db.prepare('UPDATE ai_providers SET base_url=? WHERE id=?').run(url, 'p');
    db.close();
    failure(invoke(f), 'UPSTREAM_URL_INVALID');
    assert.equal(fs.existsSync(f.output), false);
  }
});
test('existing output is preserved and no plaintext temporary export is created', () => {
  const f = fixture();
  fs.writeFileSync(f.output, 'existing-owned-file');
  failure(invoke(f), 'EXPORT_FAILED');
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'existing-owned-file');
  assert.deepEqual(fs.readdirSync(f.dir).sort(), [
    'legacy.db',
    'legacy.env',
    'master.key',
    'sealed.cms',
  ]);
});
test('binary stdout contains only authenticated ciphertext, including larger pipe writes', () => {
  const f = fixture(),
    db = new DatabaseSync(f.dbPath);
  const models = JSON.stringify(
    Array.from({ length: 16 }, (_, i) => 'model-' + i + '-'.repeat(170)),
  );
  const insert = db.prepare('INSERT INTO ai_endpoints VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 100; i++)
    insert.run(
      'large-' + i,
      'text',
      'Synthetic bulk metadata',
      'mimo',
      'https://unused.example.invalid',
      SHADOW,
      'model',
      1,
      i,
      '',
      '',
      'p',
      models,
      0,
      '{}',
    );
  db.close();
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      cli,
      '--db',
      f.dbPath,
      '--provider-ids',
      'p',
      '--legacy-env-file',
      f.envPath,
      '--recipient-cert',
      cert,
      '--recipient-sha256',
      fingerprint,
      '--output',
      '-',
    ],
    { env: childEnv, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  const summary = JSON.parse(result.stderr.toString());
  assert.ok(result.stdout.length > 64 * 1024);
  assert.equal(summary.ciphertextBytes, result.stdout.length);
  assert.equal(
    summary.ciphertextSha256,
    crypto.createHash('sha256').update(result.stdout).digest('hex'),
  );
  for (const value of [PROVIDER_SECRET, SHADOW, PRIVATE_DATA, SYSTEM_SECRET])
    assert.equal(result.stdout.includes(Buffer.from(value)), false);
  const output = path.join(f.dir, 'streamed.cms');
  fs.writeFileSync(output, result.stdout);
  const decoded = decode(output);
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.equal(JSON.parse(decoded.stdout).accounts[0].apiKey, PROVIDER_SECRET);
});
test('old-host stdin execution emits only CMS ciphertext without installing or writing the exporter', () => {
  const f = fixture();
  const result = spawnSync(
    process.execPath,
    [
      '--no-warnings',
      '--input-type=module',
      '-',
      '--db',
      f.dbPath,
      '--provider-ids',
      'p',
      '--legacy-env-file',
      f.envPath,
      '--recipient-cert',
      cert,
      '--recipient-sha256',
      fingerprint,
      '--output',
      '-',
    ],
    { env: childEnv, input: fs.readFileSync(cli), timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr?.toString());
  const summary = JSON.parse(result.stderr.toString());
  assert.equal(summary.accounts, 1);
  assert.equal(summary.ciphertextBytes, result.stdout.length);
  assert.equal(
    summary.ciphertextSha256,
    crypto.createHash('sha256').update(result.stdout).digest('hex'),
  );
  assert.deepEqual(fs.readdirSync(f.dir).sort(), ['legacy.db', 'legacy.env', 'master.key']);
  const output = path.join(f.dir, 'stdin.cms');
  fs.writeFileSync(output, result.stdout);
  const decoded = decode(output);
  assert.equal(decoded.status, 0, decoded.stderr);
  assert.equal(JSON.parse(decoded.stdout).accounts[0].apiKey, PROVIDER_SECRET);
});
test('read-only live WAL is observed instead of using immutable mode or changing source data', () => {
  const f = fixture(),
    writer = new DatabaseSync(f.dbPath);
  try {
    writer.exec('PRAGMA journal_mode=WAL;');
    writer
      .prepare('UPDATE ai_providers SET api_key=? WHERE id=?')
      .run(seal(PROVIDER_SECRET + '_LATEST_WAL', 'ai_provider:p:api_key'), 'p');
    const before = digest(f.dbPath),
      wal = digest(f.dbPath + '-wal');
    const result = invoke(f);
    assert.equal(result.status, 0, result.stderr);
    const decoded = decode(f.output);
    assert.equal(decoded.status, 0, decoded.stderr);
    assert.equal(
      JSON.parse(decoded.stdout).accounts.find((a) => a.sourceId === 'provider:p').apiKey,
      PROVIDER_SECRET + '_LATEST_WAL',
    );
    assert.equal(digest(f.dbPath), before);
    assert.equal(digest(f.dbPath + '-wal'), wal);
  } finally {
    writer.close();
  }
});
