import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, and } from 'drizzle-orm';
import {
  NotificationPayload,
  type IdentityReadPort,
  type PushPort,
  type PushRequest,
} from '@weiban/contracts';
import { CLOCK, type Clock } from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { notificationTopic, isDoNotDisturb } from '../domain/notification-rules.js';
import { pushDeliveries } from '../infra/db/schema.js';
import { PushDeliveryEngine } from './delivery-engine.js';
import { PushRequestStore } from './request-store.js';
export const PUSH_PORT = Symbol('weiban.push.port');

@Injectable()
export class PushService implements PushPort {
  constructor(
    @Inject(PushRequestStore) readonly store: PushRequestStore,
    @Inject(PushDeliveryEngine) readonly engine: PushDeliveryEngine,
    @Inject(IDENTITY_READ_PORT) readonly identity: IdentityReadPort,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}
  async send(input: PushRequest): ReturnType<PushPort['send']> {
    if (input.respectsDoNotDisturb) {
      const [profile, settings] = await Promise.all([
        this.identity.getProfile(input.userId),
        this.identity.getNotificationSettings(input.userId),
      ]);
      if (!profile || !settings) return { delivered: false, reason: 'no_device' };
      if (
        isDoNotDisturb(this.clock.now(), profile.timeZone, settings.doNotDisturb) ||
        (input.kind === 'call' && !settings.proactiveCallsEnabled)
      )
        return { delivered: false, reason: 'do_not_disturb' };
    }
    const queued = await this.store.db.transaction((tx) =>
      this.store.enqueue(tx, {
        userId: input.userId,
        dedupeKey: input.dedupeKey,
        dedupeWindowHours: input.dedupeWindowHours,
        respectsDoNotDisturb: input.respectsDoNotDisturb,
        notification: NotificationPayload.parse({
          v: 1,
          kind: input.kind,
          title: input.title,
          body: input.body,
          deepLink: input.deepLink,
          conversationId: input.conversationId,
          collapseKey: input.conversationId ?? notificationTopic(input.dedupeKey),
          count: 1,
          sound: true,
          sentAt: this.clock.now().toISOString(),
        }),
      }),
    );
    if (!queued.ids.length) return { delivered: false, reason: queued.reason };
    // 必须先提交，再发网络请求。持久队列仍负责失败恢复；accepted仅代表厂商接收。
    for (const id of queued.ids) await this.engine.run(id);
    const [accepted] = await this.store.db.db
      .select({ id: pushDeliveries.id })
      .from(pushDeliveries)
      .where(and(inArray(pushDeliveries.id, queued.ids), eq(pushDeliveries.status, 'delivered')))
      .limit(1);
    return { delivered: !!accepted };
  }
}
