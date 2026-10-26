import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { v5 as uuidV5 } from 'uuid';
import {
  AuditLog,
  EnvelopeCrypto,
  PLATFORM_KEY_OWNER,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { isActiveMaintenanceAdmin } from '../../identity/index.js';
import { LegacyImportReceiver } from './legacy-receiver.js';
import { LegacyUpstreamImportService } from './legacy-upstream-import.js';
import {
  parseLegacyMetadata,
  validateLegacyPayload,
  type LegacyPayload,
  type LegacyReceiverMetadata,
} from '../domain/legacy-import.js';

const OPERATOR = '00000000-0000-4000-8000-000000000001';
const SECRET = 'FAKE_SOURCE_API_SECRET_FOR_SYNTHETIC_RECEIVER_TEST';
const NEW_KEK = Buffer.alloc(32, 23);
const SHA = (data: Buffer) => createHash('sha256').update(data).digest('hex');
let root: string,
  sequence = 0;
class MemoryDatabase {
  keys = new Map<string, { wrapped_dek: Buffer; kek_version: number }>();
  upstreams = new Map<
    string,
    {
      id: string;
      sealed: Buffer;
      name: string;
      kind: string;
      baseUrl: string;
      enabled: boolean;
      lastTestedAt: null;
      status: string;
    }
  >();
  history: unknown[][] = [];
  audits: unknown[][] = [];
  queries: string[] = [];
  failAudit = false;
  async query<Row>(sql: string, args: unknown[] = []) {
    this.queries.push(sql);
    let rows: unknown[] = [];
    if (sql.startsWith('SELECT pg_advisory')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('SELECT wrapped_dek')) {
      const row = this.keys.get(String(args[0]));
      rows = row ? [row] : [];
    } else if (sql.includes('INSERT INTO platform.user_data_keys')) {
      if (!this.keys.has(String(args[0]))) {
        this.keys.set(String(args[0]), {
          wrapped_dek: Buffer.from(args[1] as Buffer),
          kek_version: args[2] as number,
        });
        rows = [{ owner: args[0] }];
      }
    } else if (sql.startsWith('SELECT id FROM model_access.upstreams'))
      rows = this.upstreams.has(String(args[0])) ? [{ id: args[0] }] : [];
    else if (sql.includes('INSERT INTO model_access.upstreams')) {
      expect(sql).toContain("'unavailable'");
      expect(sql).toContain('false,NULL');
      this.upstreams.set(String(args[0]), {
        id: String(args[0]),
        name: String(args[1]),
        kind: String(args[2]),
        baseUrl: String(args[3]),
        sealed: Buffer.from(args[4] as Buffer),
        enabled: false,
        lastTestedAt: null,
        status: 'unavailable',
      });
      rows = [{}];
    } else if (sql.includes('INSERT INTO model_access.upstream_status')) {
      this.history.push(args);
      rows = [{}];
    } else if (sql.includes('INSERT INTO platform.audit_log')) {
      if (this.failAudit) throw new Error('synthetic audit failure');
      this.audits.push(args);
      rows = [{}];
    } else if (sql.startsWith('SELECT id FROM identity.users'))
      rows = args[0] === OPERATOR ? [{ id: OPERATOR }] : [];
    else throw new Error('Unexpected table/query in synthetic maintenance test');
    return { rows: rows as Row[], rowCount: rows.length };
  }
  async transaction<T>(fn: (tx: DbTx) => Promise<T>): Promise<T> {
    const before = {
      keys: new Map(this.keys),
      upstreams: new Map(this.upstreams),
      history: [...this.history],
      audits: [...this.audits],
    };
    try {
      return await fn(this as unknown as DbTx);
    } catch (error) {
      this.keys = before.keys;
      this.upstreams = before.upstreams;
      this.history = before.history;
      this.audits = before.audits;
      throw error;
    }
  }
}
function payload(meta: LegacyReceiverMetadata): LegacyPayload {
  return {
    format: 'weiban-legacy-upstreams-v1',
    exportId: '00000000-0000-4000-8000-000000000002',
    createdAt: meta.createdAt,
    expiresAt: meta.expiresAt,
    recipientSha256: meta.recipientSha256,
    targetPolicy: 'disabled-pending-validation',
    accounts: [
      {
        sourceId: 'provider:p',
        name: '旧名称可能含秘密，不应进日志或目标名',
        vendor: 'mimo',
        baseUrl: 'https://api.example.invalid/v1',
        apiKey: SECRET,
        sourceEnabled: true,
        sourceOrder: 0,
        targetEnabled: false,
      },
    ],
    endpoints: [
      {
        sourceId: 'e',
        scene: 'voice_tts',
        label: '旧端点名称不入日志',
        model: 'mimo-v2.5-tts',
        modelPool: [],
        visionDirect: false,
        sourceEnabled: true,
        sourceOrder: 0,
        connectionRef: 'provider:p',
        targetEnabled: false,
      },
    ],
    envCredentials: [],
  };
}
function ssl(args: string[], input?: Buffer) {
  const env = Object.fromEntries(
    ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]!]),
  );
  const result = spawnSync(process.env.OPENSSL_BIN || 'openssl', args, {
    env,
    input,
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result.stdout;
}
async function setup() {
  const dir = path.join(root, 'case-' + ++sequence);
  fs.mkdirSync(dir, { mode: 0o700 });
  const db = new MemoryDatabase(),
    time = { value: new Date() };
  const clock = { now: () => new Date(time.value), nowMs: () => time.value.getTime() } as Clock;
  const crypto = new EnvelopeCrypto(db as unknown as Database, clock, {
    currentVersion: 9,
    keys: new Map([[9, Buffer.from(NEW_KEK)]]),
  });
  const audit = new AuditLog(db as unknown as Database, clock),
    importer = new LegacyUpstreamImportService(db as unknown as Database, clock, crypto, audit);
  const receiver = new LegacyImportReceiver(crypto, clock, importer);
  const prepared = await receiver.prepare(dir, OPERATOR, [
    { sourceId: 'provider:p', vendor: 'mimo', baseUrl: 'https://api.example.invalid/v1' },
  ]);
  const metadata = parseLegacyMetadata(
    JSON.parse(fs.readFileSync(path.join(prepared.directory, 'receiver.json'), 'utf8')),
  );
  const data = payload(metadata);
  function packet(value: unknown = data, algorithm = '-aes-256-gcm') {
    const encrypted = ssl(
      [
        'cms',
        '-encrypt',
        algorithm,
        '-binary',
        '-outform',
        'DER',
        '-recip',
        path.join(prepared.directory, 'receiver.crt'),
        '-keyopt',
        'rsa_padding_mode:oaep',
        '-keyopt',
        'rsa_oaep_md:sha256',
        '-keyopt',
        'rsa_mgf1_md:sha256',
      ],
      Buffer.from(JSON.stringify(value)),
    );
    const file = path.join(dir, 'packet-' + SHA(encrypted) + '.cms');
    fs.writeFileSync(file, encrypted, { mode: 0o600 });
    return {
      batchDirectory: prepared.directory,
      packet: file,
      expectedSha256: SHA(encrypted),
      operatorId: OPERATOR,
    };
  }
  return { dir, db, crypto, importer, receiver, prepared, metadata, data, time, packet };
}
beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'weiban-receiver-test-')));
  if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
});
afterAll(() => {
  const real = fs.realpathSync(root);
  expect(path.dirname(real)).toBe(fs.realpathSync(os.tmpdir()));
  expect(path.basename(real).startsWith('weiban-receiver-test-')).toBe(true);
  fs.rmSync(real, { recursive: true, force: true });
});

describe('strict receiver and new-platform resealing (synthetic data only)', () => {
  it('prepares a new-platform sealed receiver key, not a plaintext private key file', async () => {
    const s = await setup();
    for (const file of fs.readdirSync(s.prepared.directory))
      expect(
        fs.readFileSync(path.join(s.prepared.directory, file)).includes(Buffer.from('PRIVATE KEY')),
      ).toBe(false);
    const dek = s.db.keys.get(PLATFORM_KEY_OWNER)!;
    expect(dek.kek_version).toBe(9);
    expect(dek.wrapped_dek.includes(NEW_KEK)).toBe(false);
    expect(s.db.upstreams.size).toBe(0);
  }, 30000);
  it('plans with real authenticated CMS but does not create accounts or change prices/defaults', async () => {
    const s = await setup();
    await expect(s.receiver.plan(s.packet())).resolves.toMatchObject({
      accounts: 1,
      endpointMetadataOnly: 1,
      applies: false,
      targetEnabled: false,
    });
    expect(s.db.upstreams.size).toBe(0);
    expect(s.db.history).toHaveLength(0);
    expect(s.db.audits).toHaveLength(0);
    expect(s.db.queries.some((q) => /model_catalog|model_routes|billing\.|wallet/i.test(q))).toBe(
      false,
    );
  }, 30000);
  it('imports stopped new UUIDs through platform DEK/KEK, audits counts only and never overwrites on replay', async () => {
    const s = await setup(),
      input = s.packet();
    await expect(s.receiver.apply(input)).resolves.toMatchObject({
      createdCount: 1,
      unchangedCount: 0,
    });
    const row = [...s.db.upstreams.values()][0]!;
    expect(row.id).toBe(uuidV5('provider:p', s.metadata.batchId));
    expect(row.id).not.toBe('p');
    expect(row).toMatchObject({ enabled: false, status: 'unavailable', lastTestedAt: null });
    expect(row.name).not.toContain(s.data.accounts[0]!.name);
    expect((await s.crypto.open('platform', `upstream:${row.id}`, row.sealed)).toString()).toBe(
      SECRET,
    );
    await expect(s.crypto.open('platform', 'upstream:p', row.sealed)).rejects.toThrow();
    const wrong = new EnvelopeCrypto(
      s.db as unknown as Database,
      { now: () => new Date() } as Clock,
      { currentVersion: 9, keys: new Map([[9, Buffer.alloc(32, 99)]]) },
    );
    await expect(wrong.open('platform', `upstream:${row.id}`, row.sealed)).rejects.toThrow();
    const original = Buffer.from(row.sealed);
    row.enabled = true; // A later explicit admin edit must not be overwritten by a repeated import.
    await expect(s.receiver.apply(input)).resolves.toMatchObject({
      createdCount: 0,
      unchangedCount: 1,
    });
    expect(row.enabled).toBe(true);
    expect(row.sealed.equals(original)).toBe(true);
    expect(s.db.upstreams.size).toBe(1);
    expect(JSON.stringify(s.db.audits)).not.toContain(SECRET);
    expect(JSON.stringify(s.db.audits)).not.toContain(s.data.accounts[0]!.name);
  }, 30000);
  it('rejects a different packet after an accepted batch and rolls back all rows on audit failure', async () => {
    const s = await setup(),
      input = s.packet();
    s.db.failAudit = true;
    await expect(s.receiver.apply(input)).rejects.toThrow();
    expect(s.db.upstreams.size).toBe(0);
    expect(s.db.history).toHaveLength(0);
    s.db.failAudit = false;
    const other = structuredClone(s.data);
    other.accounts[0]!.apiKey = SECRET + '_CHANGED';
    await expect(s.receiver.apply(s.packet(other))).rejects.toMatchObject({
      code: 'REPLAY_CONFLICT',
    });
    await expect(s.receiver.apply(input)).resolves.toMatchObject({ createdCount: 1 });
  }, 30000);
  it('rejects SHA mismatch, wrong operator, expired batch and tampered authenticated ciphertext before import', async () => {
    const s = await setup(),
      input = s.packet();
    await expect(
      s.receiver.plan({ ...input, expectedSha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'PACKET_DIGEST_MISMATCH' });
    await expect(
      s.receiver.plan({ ...input, operatorId: '00000000-0000-4000-8000-000000000099' }),
    ).rejects.toMatchObject({ code: 'OPERATOR_MISMATCH' });
    const corrupt = fs.readFileSync(input.packet);
    corrupt[corrupt.length - 1]! ^= 1;
    const altered = path.join(s.dir, 'corrupt.cms');
    fs.writeFileSync(altered, corrupt);
    await expect(
      s.receiver.apply({ ...input, packet: altered, expectedSha256: SHA(corrupt) }),
    ).rejects.toThrow();
    expect(s.db.upstreams.size).toBe(0);
    s.time.value = new Date(s.time.value.getTime() + 3600001);
    await expect(s.receiver.plan(input)).rejects.toMatchObject({ code: 'RECEIVER_EXPIRED' });
  }, 30000);
  it('rejects unauthenticated CBC and metadata edits bound to the sealed private key', async () => {
    const s = await setup();
    await expect(s.receiver.plan(s.packet(s.data, '-aes-256-cbc'))).rejects.toMatchObject({
      code: 'CMS_FORMAT_REJECTED',
    });
    const altered = structuredClone(s.metadata);
    altered.approvedAccounts[0]!.baseUrl = 'https://other.example.invalid/v1';
    fs.writeFileSync(path.join(s.prepared.directory, 'receiver.json'), JSON.stringify(altered));
    await expect(s.receiver.plan(s.packet())).rejects.toThrow();
    expect(s.db.upstreams.size).toBe(0);
  }, 30000);
  it('rejects unknown/private fields, enabled targets, mismatched approved sources and unmapped env credentials', async () => {
    const s = await setup();
    expect(() =>
      validateLegacyPayload(
        { ...s.data, privateVoiceBindings: ['DO_NOT_IMPORT'] },
        s.metadata,
        s.time.value,
      ),
    ).toThrow();
    const enabled = structuredClone(s.data);
    (enabled.accounts[0] as unknown as { targetEnabled: boolean }).targetEnabled = true;
    expect(() => validateLegacyPayload(enabled, s.metadata, s.time.value)).toThrow();
    const wrong = structuredClone(s.data);
    wrong.accounts[0]!.baseUrl = 'https://unknown.example.invalid/v1';
    expect(() => validateLegacyPayload(wrong, s.metadata, s.time.value)).toThrow();
    expect(() =>
      validateLegacyPayload(
        {
          ...s.data,
          envCredentials: [{ sourceName: 'MIMO_API_KEY', apiKey: SECRET, targetEnabled: false }],
        },
        s.metadata,
        s.time.value,
      ),
    ).toThrowError('ENV_MAPPING_REQUIRED');
  }, 30000);
  it('uses identity-owned active-admin lookup only, without reading private identity fields', async () => {
    const db = new MemoryDatabase();
    await expect(isActiveMaintenanceAdmin(db, OPERATOR)).resolves.toBe(true);
    await expect(
      isActiveMaintenanceAdmin(db, '00000000-0000-4000-8000-000000000099'),
    ).resolves.toBe(false);
    await expect(isActiveMaintenanceAdmin(db, 'invalid')).resolves.toBe(false);
    expect(
      db.queries.every(
        (q) =>
          q === "SELECT id FROM identity.users WHERE id=$1 AND role='admin' AND status='active'",
      ),
    ).toBe(true);
  });
});
