/**
 * 事件订阅登记处。模块在启动时登记订阅者：
 *
 *   eventBus.subscribe({
 *     consumer: 'push.on_message_created',          // 全局唯一，用于幂等去重，上线后不要改名
 *     eventType: 'chat.message_created',
 *     handle: async (event, tx) => { ...只做快速、可重复的事；耗时工作用 tx 投递 pg-boss 任务... },
 *   });
 *
 * handle 在一个事务里执行，这个事务同时写入收件箱记录（platform.event_inbox）：
 * 处理成功 → 业务写入和「已处理」记录一起提交；处理抛错 → 一起回滚，稍后重投。
 * 同一订阅者对同一事件只会成功处理一次（重复投递直接跳过）。
 */
import type { Events } from '@weiban/contracts';
import type { DbTx } from '../db/database.js';

export const EVENT_BUS = Symbol('weiban.platform.event-bus');

export type DomainEventType = Events.DomainEventType;
export type EventOf<T extends DomainEventType> = Events.EventOf<T>;

export interface EventSubscription<T extends DomainEventType = DomainEventType> {
  /** 订阅者名：「模块.on_事件」，全局唯一。 */
  consumer: string;
  eventType: T;
  handle(event: EventOf<T>, tx: DbTx): Promise<void>;
}

export class EventBus {
  private readonly byType = new Map<string, EventSubscription[]>();
  private readonly consumers = new Set<string>();

  subscribe<T extends DomainEventType>(subscription: EventSubscription<T>): void {
    if (!/^[a-z_-]+\.[a-z0-9_]+$/.test(subscription.consumer)) {
      throw new Error(`订阅者名 ${subscription.consumer} 不合法，应为「模块.on_事件」形式`);
    }
    if (this.consumers.has(subscription.consumer)) {
      throw new Error(`订阅者名 ${subscription.consumer} 重复登记`);
    }
    this.consumers.add(subscription.consumer);
    const list = this.byType.get(subscription.eventType) ?? [];
    list.push(subscription as unknown as EventSubscription);
    this.byType.set(subscription.eventType, list);
  }

  subscribersOf(eventType: string): readonly EventSubscription[] {
    return this.byType.get(eventType) ?? [];
  }
}
