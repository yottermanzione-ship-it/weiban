import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm';
import {
  Id,
  NotificationPayload,
  NotificationEnvelope,
  type IdentityReadPort,
  type SyncPort,
} from '@weiban/contracts';
import { AppError, CLOCK, type Clock } from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { PUSH_CHANNELS, type PushChannelPort, type PushEnvelope } from '../infra/channels.js';
import { pushDeliveries, pushDevices, pushRequests } from '../infra/db/schema.js';
import { isDoNotDisturb, messageNotification } from '../domain/notification-rules.js';
import {
  PUSH_MODEL_SOURCE,
  type PushModelSource,
  PUSH_MESSAGE_SOURCE,
  type PushMessageSource,
} from '../source.js';
import { PushDeviceService } from './devices.js';
import { DELIVER_PUSH_JOB, PushRequestStore, type PushDeliveryRow } from './request-store.js';

@Injectable()
export class PushDeliveryEngine {
  constructor(
    @Inject(PushRequestStore) readonly store: PushRequestStore,
    @Inject(PushDeviceService) readonly devices: PushDeviceService,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(IDENTITY_READ_PORT) readonly identity: IdentityReadPort,
    @Inject(SYNC_PORT) readonly sync: SyncPort,
    @Inject(PUSH_MESSAGE_SOURCE) readonly source: PushMessageSource,
    @Inject(PUSH_MODEL_SOURCE) readonly models: PushModelSource,
    @Inject(PUSH_CHANNELS) readonly channels: PushChannelPort,
  ) {}
  private async prepare(row: PushDeliveryRow): Promise<NotificationPayload | null> {
    const [request] = await this.store.db.db
      .select()
      .from(pushRequests)
      .where(eq(pushRequests.id, row.requestId));
    if (!request || request.expiresAt <= this.clock.now()) return null;
    if (
      request.modelContext &&
      !(
        await this.models.affectedUsers(
          [row.userId],
          request.modelContext.modelKey,
          undefined,
          request.modelContext.previousDefaultFor,
        )
      ).includes(row.userId)
    )
      return null;
    const [profile, settings] = await Promise.all([
      this.identity.getProfile(row.userId),
      this.identity.getNotificationSettings(row.userId),
    ]);
    if (!profile || !settings) return null;
    const quiet = isDoNotDisturb(this.clock.now(), profile.timeZone, settings.doNotDisturb);
    const payload = await this.store.open(row);
    if (request.kind === 'message') {
      if (!request.messageId) return null;
      const context = await this.source.current(row.userId, request.messageId);
      if (!context || (await this.sync.isViewingConversation(row.userId, context.conversationId)))
        return null;
      return messageNotification({
        conversationId: context.conversationId,
        name: payload.title,
        content: context.content,
        scope: context.scope,
        count: row.count,
        settings,
        muted: context.muted,
        quiet,
        sentAt: this.clock.now().toISOString(),
      });
    }
    if (
      request.respectsDoNotDisturb &&
      (quiet || (request.kind === 'call' && !settings.proactiveCallsEnabled))
    )
      return null;
    return NotificationPayload.parse({
      ...payload,
      sound: payload.sound && settings.pushSoundEnabled && !quiet,
      sentAt: this.clock.now().toISOString(),
    });
  }
  async run(id: string): Promise<void> {
    await this.deliver(id);
  }

  async pollLocal(
    userId: string,
    sessionId: string,
    deviceId: string,
  ): Promise<NotificationEnvelope[]> {
    const [device] = await this.store.db.db
      .select()
      .from(pushDevices)
      .where(
        and(
          eq(pushDevices.id, deviceId),
          eq(pushDevices.userId, userId),
          eq(pushDevices.sessionId, sessionId),
          eq(pushDevices.provider, 'local_poll'),
        ),
      );
    if (!device) throw new AppError('not_found', '通知设备不存在或已关闭');
    const rows = await this.store.db.db
      .select({ id: pushDeliveries.id })
      .from(pushDeliveries)
      .where(
        and(
          eq(pushDeliveries.deviceId, deviceId),
          eq(pushDeliveries.userId, userId),
          eq(pushDeliveries.sessionId, sessionId),
          eq(pushDeliveries.status, 'queued'),
        ),
      )
      .orderBy(asc(pushDeliveries.createdAt), asc(pushDeliveries.id))
      .limit(32);
    const items: NotificationEnvelope[] = [];
    for (const row of rows) {
      const item = await this.deliver(row.id, { userId, sessionId, deviceId });
      if (item) items.push(item);
    }
    return items;
  }

  async acknowledgeLocal(
    userId: string,
    sessionId: string,
    deviceId: string,
    ids: string[],
  ): Promise<void> {
    for (const id of new Set(ids))
      await this.store.db.transaction(async (tx) => {
        await this.devices.lockUser(tx, userId);
        const [row] = await tx.db
          .select()
          .from(pushDeliveries)
          .where(
            and(
              eq(pushDeliveries.id, id),
              eq(pushDeliveries.userId, userId),
              eq(pushDeliveries.sessionId, sessionId),
              eq(pushDeliveries.deviceId, deviceId),
            ),
          )
          .for('update');
        if (!row || row.status !== 'queued') return;
        if (!(await this.devices.sessions.isActiveAppSession(userId, sessionId, tx))) return;
        const [device] = await tx.db
          .select()
          .from(pushDevices)
          .where(eq(pushDevices.id, deviceId))
          .for('update');
        if (
          device?.provider !== 'local_poll' ||
          device.userId !== userId ||
          device.sessionId !== sessionId
        )
          return;
        await this.store.finish(tx, row, 'delivered', null);
      });
  }

  private async deliver(
    id: string,
    local?: { userId: string; sessionId: string; deviceId: string },
  ): Promise<NotificationEnvelope | void> {
    Id.parse(id);
    const [first] = await this.store.db.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.id, id));
    if (!first || !['queued', 'sending'].includes(first.status) || first.dueAt > this.clock.now())
      return;
    if (
      local &&
      (first.userId !== local.userId ||
        first.sessionId !== local.sessionId ||
        first.deviceId !== local.deviceId)
    )
      return;
    const [firstDevice] = await this.store.db.db
      .select({ provider: pushDevices.provider })
      .from(pushDevices)
      .where(eq(pushDevices.id, first.deviceId));
    if ((firstDevice?.provider === 'local_poll') !== !!local) return;
    let payload: NotificationPayload | null;
    try {
      payload = await this.prepare(first);
    } catch (error) {
      // 删除账号/设备后DEK可能已消失；不能让旧任务重建任何用户数据。
      if ((await this.store.accounts.getAccountStatus(first.userId)) !== 'active') payload = null;
      else throw error;
    }
    return this.store.db.transaction(async (tx) => {
      // Local polling and unregister/rebind serialize before taking delivery/device row locks.
      if (local) await this.devices.lockUser(tx, local.userId);
      const [row] = await tx.db
        .select()
        .from(pushDeliveries)
        .where(eq(pushDeliveries.id, id))
        .for('update');
      if (
        !row ||
        !['queued', 'sending'].includes(row.status) ||
        row.dueAt > this.clock.now() ||
        (row.status === 'sending' && row.leaseUntil && row.leaseUntil > this.clock.now())
      )
        return;
      if (!payload) {
        await this.store.finish(tx, row, 'cancelled', 'suppressed_or_expired');
        return;
      }
      // 会话/账号先锁，再锁设备：与登记/退出锁顺序一致；网络I/O只有此处，时限1.5秒。
      if (!(await this.devices.sessions.isActiveAppSession(row.userId, row.sessionId, tx))) {
        await this.store.finish(tx, row, 'cancelled', 'session_inactive');
        return;
      }
      const [device] = await tx.db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.id, row.deviceId))
        .for('update');
      if (!device || device.userId !== row.userId || device.sessionId !== row.sessionId) {
        await this.store.finish(tx, row, 'cancelled', 'device_removed_or_rebound');
        return;
      }
      if (local) {
        if (device.provider !== 'local_poll') return;
        return NotificationEnvelope.parse({
          ...payload,
          recipientUserId: row.userId,
          recipientSessionId: row.sessionId,
          notificationId: row.id,
        });
      }
      if (row.attempts >= 4) {
        await this.store.finish(tx, row, 'failed', 'retry_exhausted');
        return;
      }
      const attempts = row.attempts + 1;
      await tx.db
        .update(pushDeliveries)
        .set({ status: 'sending', attempts, leaseUntil: new Date(this.clock.nowMs() + 5000) })
        .where(eq(pushDeliveries.id, row.id));
      const credential = await this.devices.open(device, tx);
      const envelope: PushEnvelope = NotificationEnvelope.parse({
        ...payload,
        recipientUserId: row.userId,
        recipientSessionId: row.sessionId,
        notificationId: row.id,
      });
      const [previous] = await tx.db
        .select({ id: pushDeliveries.providerMessageId })
        .from(pushDeliveries)
        .where(
          and(
            eq(pushDeliveries.deviceId, row.deviceId),
            eq(pushDeliveries.userId, row.userId),
            eq(pushDeliveries.sessionId, row.sessionId),
            eq(pushDeliveries.collapseKey, row.collapseKey),
            eq(pushDeliveries.status, 'delivered'),
            isNotNull(pushDeliveries.providerMessageId),
            gt(pushDeliveries.acceptedAt, new Date(this.clock.nowMs() - 30000)),
          ),
        )
        .orderBy(desc(pushDeliveries.acceptedAt))
        .limit(1);
      const response = await this.channels.send(credential, envelope, {
        previousMessageId: previous?.id ?? undefined,
      });
      const result = typeof response === 'string' ? response : response.status;
      if (typeof response !== 'string')
        await tx.db
          .update(pushDeliveries)
          .set({ providerMessageId: response.providerMessageId })
          .where(eq(pushDeliveries.id, row.id));
      if (result === 'accepted') {
        await this.store.finish(tx, row, 'delivered', null);
        return;
      }
      if (result === 'invalid_device') {
        await tx.db.delete(pushDevices).where(eq(pushDevices.id, device.id));
        await this.store.finish(tx, row, 'cancelled', 'invalid_device');
        await this.devices.cancelDevice(tx, device.id);
        return;
      }
      if (result === 'unconfigured' || attempts >= 4) {
        await this.store.finish(
          tx,
          row,
          'failed',
          result === 'unconfigured' ? result : 'retry_exhausted',
        );
        return;
      }
      const dueAt = new Date(this.clock.nowMs() + 1000 * 2 ** (attempts - 1));
      await tx.db
        .update(pushDeliveries)
        .set({ status: 'queued', attempts, dueAt, leaseUntil: null, reason: 'temporary_failure' })
        .where(eq(pushDeliveries.id, row.id));
      await this.store.jobs.send(
        DELIVER_PUSH_JOB,
        { deliveryId: row.id },
        { tx, startAfter: dueAt, retryLimit: 3, retryBackoff: true },
      );
    });
  }
}
