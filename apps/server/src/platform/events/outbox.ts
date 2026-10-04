/**
 * 事件发件箱（ADR-0004 第 2 节）：业务写入和事件写入放在同一个事务里，要么都成功，要么都不发生。
 *
 *   await database.transaction(async (tx) => {
 *     await tx.db.insert(messages).values(...);                       // 业务写入
 *     await outbox.publish(tx, 'chat.message_created', 'chat', {...}); // 同一事务写事件
 *   });
 *
 * 事务回滚 → 事件也没写进去，订阅者永远收不到；事务提交 → 分发器保证至少投递一次。
 * 事件结构以契约 Events.DomainEvent 为准，写入前严格校验（不合法直接抛错，事务随之回滚）。
 */
import { Events } from '@weiban/contracts';
import type { Clock } from '../clock/clock.js';
import type { DbTx } from '../db/database.js';
import { newId } from '../db/ids.js';
import type { DomainEventType, EventOf } from './event-bus.js';

export const OUTBOX = Symbol('weiban.platform.outbox');

export class Outbox {
  /** 事务提交后调用（用来唤醒分发器，让事件尽快送出）。 */
  private onCommitted: () => void = () => undefined;

  constructor(private readonly clock: Clock) {}

  setOnCommitted(fn: () => void): void {
    this.onCommitted = fn;
  }

  /** 在事务 tx 里发布一个事件，返回完整事件对象（含 eventId）。 */
  async publish<T extends DomainEventType>(
    tx: DbTx,
    type: T,
    producer: EventOf<T>['producer'],
    payload: EventOf<T>['payload'],
  ): Promise<EventOf<T>> {
    const occurredAt = this.clock.now();
    const event = Events.DomainEvent.parse({
      eventId: newId(),
      type,
      version: 1,
      producer,
      occurredAt: occurredAt.toISOString(),
      payload,
    }) as EventOf<T>;
    await tx.query(
      `INSERT INTO platform.outbox
         (id, event_type, producer, event, occurred_at, created_at, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $5, $5)`,
      [event.eventId, event.type, event.producer, JSON.stringify(event), occurredAt],
    );
    tx.afterCommit(() => this.onCommitted());
    return event;
  }
}
