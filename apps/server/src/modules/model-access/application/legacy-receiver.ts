/** Private maintenance receiver. Only ciphertext/private-key envelopes are written; never raw keys. */
import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  X509Certificate,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { Clock, EnvelopeCrypto } from '../../../platform/index.js';
import { PLATFORM_KEY_OWNER } from '../../../platform/index.js';
import {
  legacyFail,
  parseLegacyMetadata,
  parseLegacyScope,
  receiverAad,
  validateLegacyPayload,
  type LegacyPayload,
  type LegacyReceiverMetadata,
} from '../domain/legacy-import.js';
import type { LegacyUpstreamImportService } from './legacy-upstream-import.js';

const CERT = 'receiver.crt',
  SECRET = 'receiver-key.sealed',
  META = 'receiver.json';
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function privateDirectory(dir: string): string {
  if (!path.isAbsolute(dir)) legacyFail('PRIVATE_DIRECTORY_REQUIRED');
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) legacyFail('PRIVATE_DIRECTORY_REQUIRED');
  const normalized = path.resolve(dir),
    real = fs.realpathSync(dir);
  if (
    (process.platform === 'win32'
      ? normalized.toLowerCase() !== real.toLowerCase()
      : normalized !== real) ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    legacyFail('PRIVATE_DIRECTORY_REQUIRED');
  return real;
}
function readFile(file: string, limit: number): Buffer {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) legacyFail('FILE_REJECTED');
  return fs.readFileSync(file);
}
function json(file: string, limit = 256 * 1024): unknown {
  try {
    return JSON.parse(readFile(file, limit).toString('utf8'));
  } catch {
    return legacyFail('METADATA_INVALID');
  }
}
function writeNew(file: string, value: Buffer | string): void {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function ssl(args: string[], input?: Buffer, maxBuffer = 4 * 1024 * 1024): Buffer {
  const env = Object.fromEntries(
    ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]!]),
  );
  const result = spawnSync(process.env.OPENSSL_BIN || 'openssl', args, {
    env,
    input,
    timeout: 30000,
    maxBuffer,
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) legacyFail('CMS_OPERATION_FAILED');
  return result.stdout;
}
/** Portable OpenSSL interop: PKCS8 on disk is encrypted, its random password stays in memory/stdin. */
function withOpenSslKey(
  key: Buffer,
  directory: string,
  run: (file: string, password: Buffer) => Buffer,
): Buffer {
  const base = privateDirectory(directory);
  const file = path.join(base, `openssl-key-${randomUUID()}.pem`);
  const password = Buffer.from(randomBytes(32).toString('hex'));
  const input = Buffer.concat([password, Buffer.from('\n')]);
  let created = false;
  try {
    const encrypted = createPrivateKey(key).export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: password,
    });
    writeNew(file, encrypted);
    created = true;
    return run(file, input);
  } finally {
    try {
      if (created) {
        const target = fs.realpathSync(file),
          stat = fs.lstatSync(file);
        if (
          path.dirname(target) !== base ||
          !/^openssl-key-[0-9a-f-]{36}\.pem$/.test(path.basename(target)) ||
          !stat.isFile() ||
          stat.isSymbolicLink()
        )
          legacyFail('TEMP_KEY_PATH_INVALID');
        fs.unlinkSync(target);
      }
    } finally {
      password.fill(0);
      input.fill(0);
    }
  }
}
export interface LegacyPacketInput {
  batchDirectory: string;
  packet: string;
  expectedSha256: string;
  operatorId: string;
}
export class LegacyImportReceiver {
  constructor(
    private readonly crypto: Pick<EnvelopeCrypto, 'seal' | 'open' | 'isAvailable'>,
    private readonly clock: Clock,
    private readonly importer: Pick<LegacyUpstreamImportService, 'apply'>,
  ) {}
  async prepare(root: string, operatorId: string, rawScope: unknown) {
    const base = privateDirectory(root);
    if (!this.crypto.isAvailable()) legacyFail('PLATFORM_CRYPTO_UNAVAILABLE');
    const approvedAccounts = parseLegacyScope(rawScope),
      batchId = randomUUID(),
      now = this.clock.now();
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const key = Buffer.from(pair.privateKey);
    try {
      const directory = path.join(base, batchId);
      fs.mkdirSync(directory, { mode: 0o700 });
      const cert = withOpenSslKey(key, directory, (file, password) =>
        ssl(
          [
            'req',
            '-new',
            '-x509',
            '-key',
            file,
            '-passin',
            'stdin',
            '-days',
            '1',
            '-sha256',
            '-subj',
            `/CN=weiban-migration-${batchId}`,
            '-addext',
            'basicConstraints=critical,CA:FALSE',
            '-addext',
            'keyUsage=critical,keyEncipherment',
          ],
          password,
        ),
      );
      const certificate = new X509Certificate(cert);
      if (
        !certificate.checkPrivateKey(createPrivateKey(key)) ||
        cert.includes(Buffer.from('PRIVATE KEY'))
      )
        legacyFail('CERTIFICATE_INVALID');
      const metadata = parseLegacyMetadata({
        format: 'weiban-legacy-receiver-v1',
        batchId,
        operatorId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 3600000).toISOString(),
        recipientSha256: digest(certificate.raw),
        approvedAccounts,
      });
      const sealed = await this.crypto.seal(PLATFORM_KEY_OWNER, receiverAad(metadata), key);
      writeNew(path.join(directory, SECRET), sealed);
      writeNew(path.join(directory, CERT), cert);
      writeNew(path.join(directory, META), JSON.stringify(metadata));
      return {
        batchId,
        directory,
        recipientSha256: metadata.recipientSha256,
        expiresAt: metadata.expiresAt,
        approvedAccounts: approvedAccounts.length,
      };
    } finally {
      key.fill(0);
    }
  }
  private load(input: LegacyPacketInput): LegacyReceiverMetadata {
    privateDirectory(input.batchDirectory);
    if (!/^[0-9a-f]{64}$/.test(input.expectedSha256)) legacyFail('PACKET_DIGEST_REQUIRED');
    const metadata = parseLegacyMetadata(json(path.join(input.batchDirectory, META)));
    if (metadata.operatorId !== input.operatorId) legacyFail('OPERATOR_MISMATCH');
    const now = this.clock.now().getTime();
    if (
      Date.parse(metadata.createdAt) > now + 300000 ||
      Date.parse(metadata.expiresAt) <= now ||
      Date.parse(metadata.expiresAt) - Date.parse(metadata.createdAt) > 3600000
    )
      legacyFail('RECEIVER_EXPIRED');
    const cert = new X509Certificate(readFile(path.join(input.batchDirectory, CERT), 65536));
    if (digest(cert.raw) !== metadata.recipientSha256) legacyFail('RECIPIENT_MISMATCH');
    return metadata;
  }
  private claimFile(input: LegacyPacketInput): string {
    return path.join(input.batchDirectory, 'accepted-packet.sha256');
  }
  private assertClaim(input: LegacyPacketInput): void {
    if (
      fs.existsSync(this.claimFile(input)) &&
      readFile(this.claimFile(input), 64).toString() !== input.expectedSha256
    )
      legacyFail('REPLAY_CONFLICT');
  }
  private async decode(
    input: LegacyPacketInput,
  ): Promise<{ metadata: LegacyReceiverMetadata; data: LegacyPayload }> {
    const metadata = this.load(input);
    this.assertClaim(input);
    const packet = readFile(input.packet, 3 * 1024 * 1024);
    if (digest(packet) !== input.expectedSha256) legacyFail('PACKET_DIGEST_MISMATCH');
    // Inspect only encrypted ASN.1. CBC/unauthenticated CMS is not accepted.
    const structure = ssl(
      ['cms', '-cmsout', '-print', '-inform', 'DER'],
      packet,
      20 * 1024 * 1024,
    ).toString('utf8');
    if (
      !/^\s*contentType:\s*id-smime-ct-authEnvelopedData\b/m.test(structure) ||
      !/^\s*algorithm:\s*aes-256-gcm\b/m.test(structure) ||
      !/^\s*algorithm:\s*rsaesOaep\b/m.test(structure)
    )
      legacyFail('CMS_FORMAT_REJECTED');
    const snapshot = path.join(input.batchDirectory, `${input.expectedSha256}.cms`);
    if (fs.existsSync(snapshot)) {
      if (digest(readFile(snapshot, 3 * 1024 * 1024)) !== input.expectedSha256)
        legacyFail('SNAPSHOT_MISMATCH');
    } else writeNew(snapshot, packet);
    const key = await this.crypto.open(
      PLATFORM_KEY_OWNER,
      receiverAad(metadata),
      readFile(path.join(input.batchDirectory, SECRET), 65536),
    );
    let plain: Buffer | undefined;
    try {
      // OpenSSL gets only encrypted PKCS8 and an in-memory password, never a plaintext key file.
      // ssl() returns stdout ONLY after successful final authentication, before any JSON/DB processing.
      plain = withOpenSslKey(key, input.batchDirectory, (file, password) =>
        ssl(
          [
            'cms',
            '-decrypt',
            '-binary',
            '-inform',
            'DER',
            '-in',
            snapshot,
            '-recip',
            path.join(input.batchDirectory, CERT),
            '-inkey',
            file,
            '-passin',
            'stdin',
          ],
          password,
        ),
      );
      let raw: unknown;
      try {
        raw = JSON.parse(plain.toString('utf8'));
      } catch {
        return legacyFail('PACKAGE_INVALID');
      }
      return { metadata, data: validateLegacyPayload(raw, metadata, this.clock.now()) };
    } finally {
      key.fill(0);
      plain?.fill(0);
    }
  }
  async plan(input: LegacyPacketInput) {
    const { metadata, data } = await this.decode(input);
    return {
      batchId: metadata.batchId,
      accounts: data.accounts.length,
      endpointMetadataOnly: data.endpoints.length,
      targetEnabled: false as const,
      applies: false as const,
    };
  }
  async apply(input: LegacyPacketInput) {
    const { metadata, data } = await this.decode(input);
    try {
      writeNew(this.claimFile(input), input.expectedSha256);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      this.assertClaim(input);
    }
    const result = await this.importer.apply(input.operatorId, metadata, data);
    const receipt = path.join(input.batchDirectory, 'import-receipt.json');
    if (!fs.existsSync(receipt)) {
      try {
        writeNew(receipt, JSON.stringify({ ...result, ciphertextSha256: input.expectedSha256 }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return {
      batchId: result.batchId,
      createdCount: result.createdCount,
      unchangedCount: result.unchangedCount,
    };
  }
}
