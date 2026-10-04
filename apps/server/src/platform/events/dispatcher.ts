/**
 * 事件分发器：从发件箱取出未投递的事件，交给每个订阅者（经幂等收件箱），全部成功后标记已投递。
 *
 * - 至少一次：进程崩溃、订阅者出错都会在之后重投；已成功的订阅者由收件箱跳过，不会重复处理。
 * - 多进程安全：领取事件时加租约（locked_until），FOR UPDATE SKIP LOCKED 防止两个分发器拿到同一条。
 * - 失败重试：按 1、2、4、8……秒退避，最长 10 分钟；累计 MAX_ATTEMPTS 次仍失败则标记 dead_at 并记错误日志，
 *   需要人工处理（修好订阅者后把 dead_at 清空即可重投）。
 * - 只在 APP_ROLE = worker / all 的进程里运行（platform.module.ts 负责启动）。
 * - 时间一律取平台时钟，测试可以拨时间验证重试，不需要真的等待。
 */
import { Events } from '@weiban/contracts';
import type { Clock } from '../clock/clock.js';
import type { Database } from '../db/database.js';
import { runWithLogContext } from '../logging/log-context.js';
import type { Logger } from '../logging/logger.js';
import { redactString } from '../logging/sanitize.js';
import type { EventBus } from './event-bus.js';
import type { EventInbox } from './inbox.js';

export const EVENT_DISPATCHER = Symbol('weiban.platform.event-dispatcher');

export const MAX_ATTEMPTS = 10;
const LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;

export interface DispatchSummary {
  claimed: number;
  dispatched: number;
  failed: number;
  dead: number;
}

interface ClaimedRow {
  id: string;
  event: unknown;
  attempts: number;
  created_at: Date;
}

export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

export class EventDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private wakeRequested = false;

  constructor(
    private readonly database: Database,
    private readonly bus: EventBus,
    private readonly inbox: EventInbox,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly pollIntervalMs: number,
  ) {}

  /** 处理一批到期的事件。测试直接调用它，不需要启动轮询。 */
  async dispatchOnce(limit = 50): Promise<DispatchSummary> {
    const summary: DispatchSummary = { claimed: 0, dispatched: 0, failed: 0, dead: 0 };
    const rows = await this.claim(limit);
    summary.claimed = rows.length;
    for (const row of rows) {
      const outcome = await this.deliver(row);
      summary[outcome] += 1;
    }
    return summary;
  }

  /** 开始轮询（应用启动时调用）。 */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  /** 停止轮询，等当前批次处理完。 */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.running) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /** 有新事件提交时调用，让分发器马上处理而不用等下一次轮询。 */
  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    this.running = true;
    let busy = false;
    try {
      const summary = await this.dispatchOnce();
      busy = summary.claimed > 0;
    } catch (error) {
      this.logger.error({ err: error }, '事件分发器本轮出错');
    } finally {
      this.running = false;
    }
    const again = busy || this.wakeRequested;
    this.wakeRequested = false;
    this.schedule(again ? 0 : this.pollIntervalMs);
  }

  private async claim(limit: number): Promise<ClaimedRow[]> {
    const now = this.clock.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const { rows } = await this.database.query<ClaimedRow>(
      `UPDATE platform.outbox o
          SET locked_until = $2, attempts = o.attempts + 1
        WHERE o.id IN (
          SELECT id FROM platform.outbox
           WHERE dispatched_at IS NULL AND dead_at IS NULL
             AND next_attempt_at <= $1
             AND (locked_until IS NULL OR locked_until <= $1)
           ORDER BY created_at, id
           LIMIT $3
           FOR UPDATE SKIP LOCKED)
        RETURNING o.id, o.event, o.attempts, o.created_at`,
      [now, leaseUntil, limit],
    );
    return rows.sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id),
    );
  }

  private async deliver(row: ClaimedRow): Promise<'dispatched' | 'failed' | 'dead'> {
    return runWithLogContext({ eventId: row.id }, async () => {
      const parsed = Events.DomainEvent.safeParse(row.event);
      if (!parsed.success) {
        await this.markDead(row.id, `事件结构不符合契约：${parsed.error.issues[0]?.message ?? ''}`);
        this.logger.error({ eventId: row.id }, '发件箱里的事件不符合契约，已放弃投递');
        return 'dead';
      }
      const event = parsed.data;
      const failures: string[] = [];
      for (const subscription of this.bus.subscribersOf(event.type)) {
        try {
          await this.inbox.processOnce(subscription.consumer, event.eventId, (tx) =>
            subscription.handle(event, tx),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push(`${subscription.consumer}: ${message}`);
          this.logger.warn(
            { err: error, consumer: subscription.consumer, eventType: event.type },
            '事件订阅者处理失败，稍后重试',
          );
        }
      }
      if (failures.length === 0) {
        await this.database.query(
          `UPDATE platform.outbox
              SET dispatched_at = $2, locked_until = NULL, last_error = NULL
            WHERE id = $1`,
          [row.id, this.clock.now()],
        );
        return 'dispatched';
      }
      const lastError = redactString(failures.join(' | ')).slice(0, 200);
      if (row.attempts >= MAX_ATTEMPTS) {
        await this.markDead(row.id, lastError);
        this.logger.error(
          { eventId: row.id, eventType: event.type, attempts: row.attempts },
          '事件多次投递失败，已放弃，需要人工处理',
        );
        return 'dead';
      }
      const next = new Date(this.clock.nowMs() + backoffMs(row.attempts));
      await this.database.query(
        `UPDATE platform.outbox
            SET next_attempt_at = $2, locked_until = NULL, last_error = $3
          WHERE id = $1`,
        [row.id, next, lastError],
      );
      return 'failed';
    });
  }

  private async markDead(id: string, lastError: string): Promise<void> {
    await this.database.query(
      `UPDATE platform.outbox SET dead_at = $2, locked_until = NULL, last_error = $3 WHERE id = $1`,
      [id, this.clock.now(), redactString(lastError).slice(0, 200)],
    );
  }
}
