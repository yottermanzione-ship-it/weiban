import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';
import {
  Id,
  NotificationPayload,
  NotificationEnvelope,
  type IdentityReadPort,
  type SyncPort,
} from '@weiban/contracts';
import { CLOCK, type Clock } from '../../../platform/index.js';
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
    Id.parse(id);
    const [first] = await this.store.db.db
      .select()
      .from(pushDeliveries)
      .where(eq(pushDeliveries.id, id));
    if (!first || !['queued', 'sending'].includes(first.status) || first.dueAt > this.clock.now())
      return;
    let payload: NotificationPayload | null;
    try {
      payload = await this.prepare(first);
    } catch (error) {
      // 删除账号/设备后DEK可能已消失；不能让旧任务重建任何用户数据。
      if ((await this.store.accounts.getAccountStatus(first.userId)) !== 'active') payload = null;
      else throw error;
    }
    await this.store.db.transaction(async (tx) => {
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
