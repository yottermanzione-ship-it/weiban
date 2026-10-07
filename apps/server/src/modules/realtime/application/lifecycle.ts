import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type DbTx,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { PresenceService } from './presence.js';
import { UpdateLogService } from './update-log.js';
@Injectable()
export class RealtimeLifecycle implements OnModuleInit {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(UpdateLogService) private readonly log: UpdateLogService,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'realtime',
      purgeUser: (id) => this.log.purgeUser(id),
      countUserData: (id) => this.log.countUserData(id),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_profile_updated',
      eventType: 'identity.profile_updated',
      handle: (event, tx) => this.settings(tx, event.payload.userId, 'profile'),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_preferences_updated',
      eventType: 'identity.preferences_updated',
      handle: (event, tx) => this.settings(tx, event.payload.userId, 'preferences'),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_notification_settings_updated',
      eventType: 'identity.notification_settings_updated',
      handle: (event, tx) => this.settings(tx, event.payload.userId, 'notification'),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_balance_changed',
      eventType: 'billing.balance_changed',
      handle: (event, tx) => this.settings(tx, event.payload.userId, 'wallet'),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_selection_changed',
      eventType: 'model_access.selection_changed',
      handle: (event, tx) =>
        this.settings(tx, event.payload.userId, 'model_selection', event.payload.characterId),
    });
    this.bus.subscribe({
      consumer: 'realtime.on_user_message_created',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        if (event.payload.senderKind === 'user' && event.payload.senderRefId)
          await this.presence.recordUserActivity(tx, event.payload.senderRefId, event.occurredAt);
      },
    });
    await this.jobs.work('realtime.prune_updates', async () => {
      await this.log.pruneExpired();
      await this.presence.pruneExpired();
    });
    await this.jobs.schedule('realtime.prune_updates', '17 * * * *');
  }
  private async settings(
    tx: DbTx,
    userId: string,
    section: 'profile' | 'preferences' | 'notification' | 'wallet' | 'model_selection',
    characterId: string | null = null,
  ): Promise<void> {
    // 迟到事件不重建已注销账号的数据；检查和写入使用同一用户锁。
    if (!(await this.log.isActive(tx, userId))) return;
    await this.log.appendUpdate(tx, userId, {
      type: 'settings.updated',
      data: { section, characterId },
    });
  }
}
