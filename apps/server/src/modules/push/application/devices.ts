import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  Id,
  PushDevice,
  RegisterPushDeviceRequest,
  type IdentitySessionReadPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
} from '../../../platform/index.js';
import { IDENTITY_SESSION_READ_PORT } from '../../identity/index.js';
import { PUSH_CHANNELS, type PushChannelPort } from '../infra/channels.js';
import { pushDevices, pushDeliveries } from '../infra/db/schema.js';
export type PushDeviceRow = typeof pushDevices.$inferSelect;

@Injectable()
export class PushDeviceService {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) readonly crypto: EnvelopeCrypto,
    @Inject(IDENTITY_SESSION_READ_PORT) readonly sessions: IdentitySessionReadPort,
    @Inject(PUSH_CHANNELS) readonly channels: PushChannelPort,
  ) {}
  async lockUser(tx: DbTx, userId: string): Promise<void> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('push:user:' || $1,0))", [
      userId,
    ]);
  }
  async register(userId: string, sessionId: string, input: unknown): Promise<PushDevice> {
    parseContract(Id, userId);
    parseContract(Id, sessionId);
    const credential = parseContract(RegisterPushDeviceRequest, input);
    this.channels.validate(credential);
    const key =
      credential.kind === 'webpush'
        ? `webpush:${credential.subscription.endpoint}`
        : `android:${credential.provider}:${credential.token}`;
    const credentialHash = createHash('sha256').update(key).digest('hex');
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('push:credential:' || $1,0))", [
        credentialHash,
      ]);
      await this.lockUser(tx, userId);
      if (!(await this.sessions.isActiveAppSession(userId, sessionId, tx)))
        throw new AppError('unauthenticated', '登录已失效');
      const [old] = await tx.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.credentialHash, credentialHash))
        .for('update');
      const id = old?.id ?? newId();
      const plain = Buffer.from(JSON.stringify(credential));
      let sealed: Buffer;
      try {
        sealed = await this.crypto.seal(userId, `push:device:${id}`, plain, tx);
      } finally {
        plain.fill(0);
      }
      const now = this.clock.now();
      const values = {
        id,
        userId,
        sessionId,
        kind: credential.kind,
        provider: credential.kind === 'webpush' ? 'webpush' : credential.provider,
        credentialHash,
        credentialCiphertext: sealed,
        createdAt: old?.createdAt ?? now,
        updatedAt: now,
      };
      if (old) {
        if (old.userId !== userId || old.sessionId !== sessionId) {
          // 不允许旧任务在新账号/新会话使用同一个系统设备凭证。
          await this.cancelDevice(tx, id, 'device_rebound');
        }
        await tx.db.update(pushDevices).set(values).where(eq(pushDevices.id, id));
      } else await tx.db.insert(pushDevices).values(values);
      return PushDevice.parse({
        pushDeviceId: id,
        kind: values.kind,
        sessionId,
        createdAt: values.createdAt.toISOString(),
      });
    });
  }
  async unregister(userId: string, sessionId: string, deviceId: string): Promise<void> {
    parseContract(Id, deviceId);
    await this.db.transaction(async (tx) => {
      await this.lockUser(tx, userId);
      if (!(await this.sessions.isActiveAppSession(userId, sessionId, tx)))
        throw new AppError('unauthenticated', '登录已失效');
      const deleted = await tx.db
        .delete(pushDevices)
        .where(and(eq(pushDevices.id, deviceId), eq(pushDevices.userId, userId)))
        .returning({ id: pushDevices.id });
      if (deleted.length) await this.cancelDevice(tx, deviceId);
    });
  }
  async cancelDevice(tx: DbTx, deviceId: string, reason = 'device_removed'): Promise<void> {
    await tx.db
      .update(pushDeliveries)
      .set({
        status: 'cancelled',
        payloadCiphertext: null,
        reason,
        leaseUntil: null,
      })
      .where(
        and(
          eq(pushDeliveries.deviceId, deviceId),
          inArray(pushDeliveries.status, ['queued', 'sending']),
        ),
      );
    await tx.query(
      `UPDATE push.requests r SET payload_ciphertext=NULL
      WHERE r.id IN (SELECT request_id FROM push.deliveries WHERE device_id=$1)
      AND NOT EXISTS(SELECT 1 FROM push.deliveries d WHERE d.request_id=r.id AND d.status IN ('queued','sending'))`,
      [deviceId],
    );
  }
  async open(row: PushDeviceRow, tx?: DbTx): Promise<RegisterPushDeviceRequest> {
    const plain = await this.crypto.open(
      row.userId,
      `push:device:${row.id}`,
      row.credentialCiphertext,
      tx,
    );
    try {
      return RegisterPushDeviceRequest.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
}
