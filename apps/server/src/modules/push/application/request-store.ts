import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNotNull, lt, lte, or } from 'drizzle-orm';
import {
  Id,
  NotificationPayload,
  Timestamp,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type JobQueue,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { PushDeviceService } from './devices.js';
import { adminAlerts, pushDeliveries, pushDevices, pushRequests } from '../infra/db/schema.js';
export const DELIVER_PUSH_JOB = 'push.deliver';
export type PushDeliveryRow = typeof pushDeliveries.$inferSelect;
export interface NotificationRequest {
  userId: string;
  eventId?: string;
  dedupeKey: string;
  dedupeWindowHours: number;
  notification: NotificationPayload;
  messageId?: string;
  occurredAt?: string;
  respectsDoNotDisturb?: boolean;
  modelContext?: NonNullable<typeof pushRequests.$inferSelect.modelContext>;
}
@Injectable()
export class PushRequestStore {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) readonly crypto: EnvelopeCrypto,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(PushDeviceService) readonly devices: PushDeviceService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) readonly accounts: IdentityAccountStatusPort,
  ) {}
  async enqueue(
    tx: DbTx,
    input: NotificationRequest,
  ): Promise<{ ids: string[]; reason?: 'deduplicated' | 'no_device' }> {
    parseContract(Id, input.userId);
    if (input.eventId) parseContract(Id, input.eventId);
    if (input.messageId) parseContract(Id, input.messageId);
    if (input.occurredAt) parseContract(Timestamp, input.occurredAt);
    const notification = parseContract(NotificationPayload, input.notification);
    if (
      notification.kind === 'unsupported' ||
      input.dedupeKey.length < 1 ||
      input.dedupeKey.length > 256 ||
      !Number.isFinite(input.dedupeWindowHours) ||
      input.dedupeWindowHours < 0 ||
      input.dedupeWindowHours > 8760
    )
      throw new AppError('bad_request', '无效推送请求');
    await this.devices.lockUser(tx, input.userId);
    if ((await this.accounts.getAccountStatus(input.userId, tx)) !== 'active')
      return { ids: [], reason: 'no_device' };
    const now = this.clock.now();
    const createdAt = input.occurredAt ? new Date(input.occurredAt) : now;
    if (createdAt.getTime() + 10 * 60 * 1000 <= now.getTime())
      return { ids: [], reason: 'no_device' };
    const [duplicate] = await tx.db
      .select({ id: pushRequests.id })
      .from(pushRequests)
      .where(
        and(
          eq(pushRequests.userId, input.userId),
          or(
            input.eventId ? eq(pushRequests.eventId, input.eventId) : undefined,
            input.dedupeWindowHours > 0
              ? and(
                  eq(pushRequests.dedupeKey, input.dedupeKey),
                  gt(
                    pushRequests.createdAt,
                    new Date(now.getTime() - input.dedupeWindowHours * 3600000),
                  ),
                )
              : undefined,
          ),
        ),
      )
      .limit(1);
    if (duplicate && (input.eventId || input.dedupeWindowHours > 0))
      return { ids: [], reason: 'deduplicated' };
    const registered = await tx.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.userId, input.userId));
    const valid = [];
    for (const device of registered) {
      if (await this.devices.sessions.isActiveAppSession(input.userId, device.sessionId, tx))
        valid.push(device);
      else {
        await tx.db.delete(pushDevices).where(eq(pushDevices.id, device.id));
        await this.devices.cancelDevice(tx, device.id);
      }
    }
    if (!valid.length) return { ids: [], reason: 'no_device' };
    const requestId = newId();
    const seal = (aad: string, value: NotificationPayload) =>
      this.crypto.seal(input.userId, aad, JSON.stringify(value), tx);
    await tx.db.insert(pushRequests).values({
      id: requestId,
      userId: input.userId,
      eventId: input.eventId ?? null,
      kind: notification.kind,
      respectsDoNotDisturb: input.respectsDoNotDisturb ?? false,
      modelContext: input.modelContext ?? null,
      dedupeKey: input.dedupeKey,
      conversationId: notification.conversationId,
      messageId: input.messageId ?? null,
      payloadCiphertext: await seal(`push:request:${requestId}`, notification),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 10 * 60 * 1000),
    });
    const ids = [];
    for (const device of valid) {
      const [previous] =
        notification.kind === 'message'
          ? await tx.db
              .select()
              .from(pushDeliveries)
              .where(
                and(
                  eq(pushDeliveries.deviceId, device.id),
                  eq(pushDeliveries.sessionId, device.sessionId),
                  eq(pushDeliveries.collapseKey, notification.collapseKey),
                  gt(pushDeliveries.createdAt, new Date(now.getTime() - 30000)),
                  inArray(pushDeliveries.status, ['queued', 'sending', 'delivered']),
                ),
              )
              .orderBy(desc(pushDeliveries.createdAt), desc(pushDeliveries.id))
              .limit(1)
          : [];
      const count = (previous?.count ?? 0) + 1;
      const payload = NotificationPayload.parse({
        ...notification,
        count,
        body:
          count > 1 && notification.kind === 'message'
            ? `${notification.title} 发来 ${count} 条消息`.slice(0, 200)
            : notification.body,
      });
      // 合并只取消未开始任务；已经交通道的用同collapse替换，客户端还按稳定notificationId去重。
      const collapsed = await tx.db
        .update(pushDeliveries)
        .set({ status: 'cancelled', payloadCiphertext: null, reason: 'collapsed' })
        .where(
          and(
            eq(pushDeliveries.deviceId, device.id),
            eq(pushDeliveries.collapseKey, notification.collapseKey),
            eq(pushDeliveries.status, 'queued'),
          ),
        )
        .returning();
      for (const old of collapsed) await this.finish(tx, old, 'cancelled', 'collapsed');
      const id = newId();
      await tx.db.insert(pushDeliveries).values({
        id,
        userId: input.userId,
        deviceId: device.id,
        requestId,
        sessionId: device.sessionId,
        collapseKey: notification.collapseKey,
        payloadCiphertext: await seal(`push:delivery:${id}`, payload),
        count,
        status: 'queued',
        dueAt: now,
        createdAt,
      });
      await this.jobs.send(
        DELIVER_PUSH_JOB,
        { deliveryId: id },
        { tx, retryLimit: 3, retryBackoff: true },
      );
      ids.push(id);
    }
    return { ids };
  }
  async open(row: PushDeliveryRow): Promise<NotificationPayload> {
    if (!row.payloadCiphertext) throw new AppError('not_found', '推送已结束');
    const plain = await this.crypto.open(
      row.userId,
      `push:delivery:${row.id}`,
      row.payloadCiphertext,
    );
    try {
      return NotificationPayload.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
  async finish(
    tx: DbTx,
    row: PushDeliveryRow,
    status: 'delivered' | 'cancelled' | 'failed',
    reason: string | null,
  ): Promise<void> {
    // 同请求多设备同时完成时串行检查，最后一台必须清掉共享请求密文。
    await tx.db
      .select({ id: pushRequests.id })
      .from(pushRequests)
      .where(eq(pushRequests.id, row.requestId))
      .for('update');
    await tx.db
      .update(pushDeliveries)
      .set({
        status,
        reason,
        payloadCiphertext: null,
        leaseUntil: null,
        acceptedAt: status === 'delivered' ? this.clock.now() : null,
      })
      .where(eq(pushDeliveries.id, row.id));
    const [unfinished] = await tx.db
      .select({ id: pushDeliveries.id })
      .from(pushDeliveries)
      .where(
        and(
          eq(pushDeliveries.requestId, row.requestId),
          inArray(pushDeliveries.status, ['queued', 'sending']),
        ),
      )
      .limit(1);
    if (!unfinished)
      await tx.db
        .update(pushRequests)
        .set({ payloadCiphertext: null })
        .where(eq(pushRequests.id, row.requestId));
  }
  async reconcile(): Promise<void> {
    const now = this.clock.now();
    const rows = await this.db.db
      .select({ id: pushDeliveries.id })
      .from(pushDeliveries)
      .where(
        or(
          and(eq(pushDeliveries.status, 'queued'), lte(pushDeliveries.dueAt, now)),
          and(eq(pushDeliveries.status, 'sending'), lte(pushDeliveries.leaseUntil, now)),
        ),
      )
      .limit(200);
    for (const row of rows)
      await this.jobs.send(
        DELIVER_PUSH_JOB,
        { deliveryId: row.id },
        { retryLimit: 3, retryBackoff: true },
      );
  }
  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.devices.lockUser(tx, userId);
      const sizes = [
        await tx.db
          .delete(pushDeliveries)
          .where(eq(pushDeliveries.userId, userId))
          .returning({ id: pushDeliveries.id }),
        await tx.db
          .delete(pushRequests)
          .where(eq(pushRequests.userId, userId))
          .returning({ id: pushRequests.id }),
        await tx.db
          .delete(pushDevices)
          .where(eq(pushDevices.userId, userId))
          .returning({ id: pushDevices.id }),
        await tx.db
          .update(adminAlerts)
          .set({ acknowledgedByUserId: null })
          .where(eq(adminAlerts.acknowledgedByUserId, userId))
          .returning({ id: adminAlerts.id }),
      ];
      return sizes.reduce((n, rows) => n + rows.length, 0);
    });
  }
  async countUserData(userId: string): Promise<number> {
    const result = await this.db.query<{ n: string }>(
      `SELECT
      (SELECT count(*) FROM push.devices WHERE user_id=$1)+
      (SELECT count(*) FROM push.requests WHERE user_id=$1)+
      (SELECT count(*) FROM push.deliveries WHERE user_id=$1)+
      (SELECT count(*) FROM push.admin_alerts WHERE acknowledged_by_user_id=$1) AS n`,
      [userId],
    );
    return Number(result.rows[0]!.n);
  }
  async prune(): Promise<void> {
    await this.db.transaction(async (tx) => {
      const expired = await tx.db
        .select({ id: pushRequests.id })
        .from(pushRequests)
        .where(
          and(
            lte(pushRequests.expiresAt, this.clock.now()),
            isNotNull(pushRequests.payloadCiphertext),
          ),
        )
        .orderBy(pushRequests.expiresAt)
        .limit(200);
      const ids = expired.map((r) => r.id);
      if (ids.length) {
        await tx.db
          .update(pushDeliveries)
          .set({
            status: 'cancelled',
            reason: 'expired',
            payloadCiphertext: null,
            leaseUntil: null,
          })
          .where(
            and(
              inArray(pushDeliveries.requestId, ids),
              inArray(pushDeliveries.status, ['queued', 'sending']),
            ),
          );
        await tx.db
          .update(pushRequests)
          .set({ payloadCiphertext: null })
          .where(inArray(pushRequests.id, ids));
      }
      const cutoff = new Date(this.clock.nowMs() - 90 * 24 * 60 * 60 * 1000);
      await tx.db.delete(pushDeliveries).where(lt(pushDeliveries.createdAt, cutoff));
      await tx.db.delete(pushRequests).where(lt(pushRequests.createdAt, cutoff));
    });
  }
}
