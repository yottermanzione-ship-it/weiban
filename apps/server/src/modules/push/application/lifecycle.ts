import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, lte } from 'drizzle-orm';
import {
  NotificationPayload,
  type IdentityDirectoryPort,
  type IdentityReadPort,
  type SyncPort,
} from '@weiban/contracts';
import {
  CLOCK,
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type Clock,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { IDENTITY_DIRECTORY_PORT, IDENTITY_READ_PORT } from '../../identity/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  PUSH_MODEL_SOURCE,
  type PushModelSource,
  PUSH_MESSAGE_SOURCE,
  type PushMessageSource,
} from '../source.js';
import { pushDevices } from '../infra/db/schema.js';
import {
  isDoNotDisturb,
  messageNotification,
  notificationTopic,
} from '../domain/notification-rules.js';
import { AdminAlertService } from './admin-alerts.js';
import { PushDeviceService } from './devices.js';
import { PushDeliveryEngine } from './delivery-engine.js';
import { DELIVER_PUSH_JOB, PushRequestStore } from './request-store.js';
@Injectable()
export class PushLifecycle implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(PushRequestStore) readonly store: PushRequestStore,
    @Inject(PushDeviceService) readonly devices: PushDeviceService,
    @Inject(PushDeliveryEngine) readonly engine: PushDeliveryEngine,
    @Inject(AdminAlertService) readonly alerts: AdminAlertService,
    @Inject(IDENTITY_READ_PORT) readonly identity: IdentityReadPort,
    @Inject(IDENTITY_DIRECTORY_PORT) readonly directory: IdentityDirectoryPort,
    @Inject(SYNC_PORT) readonly sync: SyncPort,
    @Inject(PUSH_MODEL_SOURCE) readonly models: PushModelSource,
    @Inject(PUSH_MESSAGE_SOURCE) readonly source: PushMessageSource,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(EVENT_BUS) readonly bus: EventBus,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) readonly registry: UserDataRegistry,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.jobs.isReady)
      await this.jobs.send('push.reconcile', {}, { retryLimit: 3, retryBackoff: true });
  }
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'push',
      purgeUser: (id) => this.store.purgeUser(id),
      countUserData: (id) => this.store.countUserData(id),
    });
    await this.jobs.work<{ deliveryId: string }>(
      DELIVER_PUSH_JOB,
      (job) => this.engine.run(job.data.deliveryId),
      { pollingIntervalSeconds: 0.5, localConcurrency: 4 },
    );
    await this.jobs.work('push.reconcile', () => this.store.reconcile());
    await this.jobs.schedule('push.reconcile', '* * * * *');
    await this.jobs.work('push.prune', async () => {
      await this.store.prune();
      await this.alerts.prune();
    });
    await this.jobs.schedule('push.prune', '*/5 * * * *');
    await this.jobs.work<ModelNoticeJob>('push.model_notice', (job) => this.modelNotice(job.data));
    this.bus.subscribe({
      consumer: 'push.on_model_status',
      eventType: 'model_access.model_status_changed',
      handle: async (event, tx) => {
        if (!event.payload.available)
          await this.jobs.send(
            'push.model_notice',
            {
              eventId: event.eventId,
              modelKey: event.payload.modelKey,
              occurredAt: event.occurredAt,
              previousDefaultFor: event.payload.previousDefaultFor,
            },
            { tx, retryLimit: 3, retryBackoff: true },
          );
      },
    });
    this.bus.subscribe({
      consumer: 'push.on_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        if (event.payload.senderKind === 'system') return;
        for (const userId of event.payload.userRecipientIds) {
          const context = await this.source.current(userId, event.payload.messageId, tx);
          if (
            !context ||
            (await this.sync.isViewingConversation(userId, context.conversationId, tx))
          )
            continue;
          if (
            context.conversationType === 'group' &&
            context.muted &&
            !event.payload.mentionedParticipantIds.includes(context.recipientParticipantId)
          )
            continue;
          const profile = await this.identity.getProfile(userId, tx);
          const settings = await this.identity.getNotificationSettings(userId, tx);
          if (!profile || !settings) continue;
          const name = await this.source.name(
            userId,
            context.senderKind === 'character' ? context.senderRefId : null,
            tx,
          );
          const notification = messageNotification({
            conversationId: context.conversationId,
            name,
            content: context.content,
            scope: context.scope,
            count: 1,
            settings,
            muted: context.muted,
            quiet: isDoNotDisturb(this.clock.now(), profile.timeZone, settings.doNotDisturb),
            sentAt: this.clock.now().toISOString(),
          });
          await this.store.enqueue(tx, {
            userId,
            eventId: event.eventId,
            dedupeKey: `message:${event.payload.messageId}`,
            dedupeWindowHours: 0,
            notification,
            messageId: event.payload.messageId,
            occurredAt: event.occurredAt,
          });
        }
      },
    });
    this.bus.subscribe({
      consumer: 'push.on_session_revoked',
      eventType: 'identity.session_revoked',
      handle: async (event, tx) => {
        await this.devices.lockUser(tx, event.payload.userId);
        const rows = await tx.db
          .delete(pushDevices)
          .where(eq(pushDevices.sessionId, event.payload.sessionId))
          .returning({ id: pushDevices.id });
        for (const row of rows) await this.devices.cancelDevice(tx, row.id);
      },
    });
    this.bus.subscribe({
      consumer: 'push.on_balance_depleted',
      eventType: 'billing.balance_depleted',
      handle: async (event, tx) => {
        const userId = event.payload.userId;
        await this.store.enqueue(tx, {
          userId,
          eventId: event.eventId,
          dedupeKey: 'balance:depleted',
          dedupeWindowHours: 24,
          notification: NotificationPayload.parse({
            v: 1,
            kind: 'balance',
            collapseKey: 'balance',
            title: '微伴',
            body: '余额不足，充值后可以继续聊天',
            count: 1,
            deepLink: '/wallet',
            conversationId: null,
            sound: true,
            sentAt: this.clock.now().toISOString(),
          }),
          occurredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'push.on_balance_low',
      eventType: 'billing.balance_low',
      handle: async (event, tx) => {
        await this.store.enqueue(tx, {
          userId: event.payload.userId,
          eventId: event.eventId,
          dedupeKey: 'balance:low',
          dedupeWindowHours: 24,
          notification: NotificationPayload.parse({
            v: 1,
            kind: 'balance',
            collapseKey: 'balance',
            title: '微伴',
            body: '余额较低，可以在服务里查看余额',
            count: 1,
            deepLink: '/wallet',
            conversationId: null,
            sound: true,
            sentAt: this.clock.now().toISOString(),
          }),
          occurredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'push.on_admin_alert',
      eventType: 'platform.admin_alert_raised',
      handle: async (event, tx) => {
        const { alert, shouldPush } = await this.alerts.raise(tx, event.payload);
        if (!shouldPush) return;
        for (const userId of await this.directory.listAdminUserIds(tx)) {
          await this.store.enqueue(tx, {
            userId,
            eventId: event.eventId,
            dedupeKey: `admin:${alert.alertId}`,
            dedupeWindowHours: 24,
            notification: NotificationPayload.parse({
              v: 1,
              kind: 'admin_alert',
              collapseKey: `admin:${alert.alertId}`,
              title: '微伴管理提醒',
              body: alert.summary,
              count: 1,
              deepLink: '/admin/alerts',
              conversationId: null,
              sound: true,
              sentAt: this.clock.now().toISOString(),
            }),
            occurredAt: event.occurredAt,
          });
        }
      },
    });
  }
  async modelNotice(input: ModelNoticeJob): Promise<void> {
    if (new Date(input.occurredAt).getTime() + 600000 <= this.clock.nowMs()) return;
    await this.store.db.transaction(async (tx) => {
      const rows = await tx.db
        .selectDistinct({ userId: pushDevices.userId })
        .from(pushDevices)
        .where(
          and(
            lte(pushDevices.createdAt, new Date(input.occurredAt)),
            input.afterUserId ? gt(pushDevices.userId, input.afterUserId) : undefined,
          ),
        )
        .orderBy(asc(pushDevices.userId))
        .limit(50);
      for (const userId of await this.models.affectedUsers(
        rows.map((r) => r.userId),
        input.modelKey,
        tx,
        input.previousDefaultFor,
      )) {
        await this.store.enqueue(tx, {
          userId,
          eventId: input.eventId,
          dedupeKey: `model:${input.modelKey}`,
          dedupeWindowHours: 24,
          modelContext: {
            modelKey: input.modelKey,
            previousDefaultFor: input.previousDefaultFor ?? [],
          },
          occurredAt: input.occurredAt,
          notification: NotificationPayload.parse({
            v: 1,
            kind: 'model_status',
            title: '微伴',
            body: '你选择的模型暂时不可用，可以在服务里检查模型设置',
            deepLink: '/models',
            conversationId: null,
            collapseKey: `model:${notificationTopic(input.modelKey)}`,
            count: 1,
            sound: true,
            sentAt: this.clock.now().toISOString(),
          }),
        });
      }
      if (rows.length === 50)
        await this.jobs.send(
          'push.model_notice',
          {
            ...input,
            afterUserId: rows.at(-1)!.userId,
          },
          { tx, retryLimit: 3, retryBackoff: true },
        );
    });
  }
}

interface ModelNoticeJob {
  eventId: string;
  modelKey: string;
  occurredAt: string;
  afterUserId?: string;
  previousDefaultFor?: ('chat' | 'background' | 'vision')[];
}
