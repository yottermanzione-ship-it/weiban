/**
 * 验收：发件箱——业务写入和事件写入在同一事务中，事务回滚则事件不发出；
 *       收件箱——同一事件重复投递只处理一次。
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { TestClock } from '../src/platform/clock/clock.js';
import { Database } from '../src/platform/db/database.js';
import { newId } from '../src/platform/db/ids.js';
import { backoffMs, EventDispatcher, MAX_ATTEMPTS } from '../src/platform/events/dispatcher.js';
import { EventBus } from '../src/platform/events/event-bus.js';
import { EventInbox } from '../src/platform/events/inbox.js';
import { Outbox } from '../src/platform/events/outbox.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';
import { captureLogger } from './support/fixtures.js';

describeDb('事件发件箱与幂等收件箱（真实 PostgreSQL）', () => {
  let database: Database;
  const clock = new TestClock('2026-10-05T08:00:00.000Z');

  beforeAll(async () => {
    await resetTestDatabase();
    database = new Database({ url: requireTestDatabaseUrl() });
    // 模拟「业务模块自己的表」：测试专用 schema，与 platform 隔离
    await database.query('CREATE SCHEMA IF NOT EXISTS kernel_test');
    await database.query(
      'CREATE TABLE IF NOT EXISTS kernel_test.things (id uuid PRIMARY KEY, note text NOT NULL)',
    );
    await database.query(
      'CREATE TABLE IF NOT EXISTS kernel_test.effects (event_id uuid NOT NULL, consumer text NOT NULL)',
    );
  });

  beforeEach(async () => {
    await database.query('TRUNCATE platform.outbox, platform.event_inbox');
    await database.query('TRUNCATE kernel_test.things, kernel_test.effects');
    clock.set('2026-10-05T08:00:00.000Z');
  });

  afterAll(async () => {
    await database?.close();
  });

  function setup() {
    const bus = new EventBus();
    const inbox = new EventInbox(database, clock);
    const outbox = new Outbox(clock);
    const { logger } = captureLogger();
    const dispatcher = new EventDispatcher(database, bus, inbox, clock, logger, 1000);
    return { bus, inbox, outbox, dispatcher };
  }

  const payload = () => ({ userId: newId() });

  async function count(sql: string): Promise<number> {
    const { rows } = await database.query<{ n: string }>(sql);
    return Number(rows[0]?.n ?? 0);
  }

  it('事务提交：业务数据和事件一起落库，occurredAt 来自平台时钟', async () => {
    const { outbox } = setup();
    const event = await database.transaction(async (tx) => {
      await tx.query('INSERT INTO kernel_test.things (id, note) VALUES ($1, $2)', [newId(), 'a']);
      return outbox.publish(tx, 'identity.user_registered', 'identity', payload());
    });
    expect(event.occurredAt).toBe('2026-10-05T08:00:00.000Z');
    expect(await count('SELECT count(*) AS n FROM kernel_test.things')).toBe(1);
    expect(await count('SELECT count(*) AS n FROM platform.outbox')).toBe(1);
  });

  it('事务回滚：业务数据和事件都不存在，订阅者永远收不到', async () => {
    const { bus, outbox, dispatcher } = setup();
    let received = 0;
    bus.subscribe({
      consumer: 'test.on_user_registered',
      eventType: 'identity.user_registered',
      handle: async () => {
        received += 1;
      },
    });
    await expect(
      database.transaction(async (tx) => {
        await tx.query('INSERT INTO kernel_test.things (id, note) VALUES ($1, $2)', [newId(), 'a']);
        await outbox.publish(tx, 'identity.user_registered', 'identity', payload());
        throw new Error('业务后续步骤失败');
      }),
    ).rejects.toThrow('业务后续步骤失败');
    expect(await count('SELECT count(*) AS n FROM kernel_test.things')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM platform.outbox')).toBe(0);
    expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
    expect(received).toBe(0);
  });

  it('不符合契约的事件写不进去（随事务回滚）', async () => {
    const { outbox } = setup();
    await expect(
      database.transaction((tx) =>
        outbox.publish(tx, 'identity.user_registered', 'identity', {
          userId: 'not-a-uuid',
        }),
      ),
    ).rejects.toThrow();
    expect(await count('SELECT count(*) AS n FROM platform.outbox')).toBe(0);
  });

  it('提交后的回调只在提交成功时执行', async () => {
    let called = 0;
    await database.transaction(async (tx) => {
      tx.afterCommit(() => {
        called += 1;
      });
    });
    await database
      .transaction(async (tx) => {
        tx.afterCommit(() => {
          called += 100;
        });
        throw new Error('回滚');
      })
      .catch(() => undefined);
    expect(called).toBe(1);
  });

  it('分发：每个订阅者收到一次，事件标记为已投递，再次分发不重复', async () => {
    const { bus, outbox, dispatcher } = setup();
    const seen: string[] = [];
    for (const consumer of ['test.on_a', 'test.on_b']) {
      bus.subscribe({
        consumer,
        eventType: 'identity.user_registered',
        handle: async (event, tx) => {
          seen.push(`${consumer}:${event.payload.userId}`);
          await tx.query('INSERT INTO kernel_test.effects (event_id, consumer) VALUES ($1, $2)', [
            event.eventId,
            consumer,
          ]);
        },
      });
    }
    const event = await database.transaction((tx) =>
      outbox.publish(tx, 'identity.user_registered', 'identity', payload()),
    );
    expect(await dispatcher.dispatchOnce()).toMatchObject({ claimed: 1, dispatched: 1 });
    expect(seen).toHaveLength(2);
    expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
    expect(await count('SELECT count(*) AS n FROM kernel_test.effects')).toBe(2);
    expect(
      await count(
        `SELECT count(*) AS n FROM platform.outbox WHERE id = '${event.eventId}' AND dispatched_at IS NOT NULL`,
      ),
    ).toBe(1);
  });

  it('收件箱：同一事件重复投递，只处理一次', async () => {
    const { bus, inbox, outbox, dispatcher } = setup();
    let handled = 0;
    bus.subscribe({
      consumer: 'test.on_registered_once',
      eventType: 'identity.user_registered',
      handle: async (event, tx) => {
        handled += 1;
        await tx.query('INSERT INTO kernel_test.effects (event_id, consumer) VALUES ($1, $2)', [
          event.eventId,
          'once',
        ]);
      },
    });
    const event = await database.transaction((tx) =>
      outbox.publish(tx, 'identity.user_registered', 'identity', payload()),
    );
    await dispatcher.dispatchOnce();
    // 模拟「至少一次」造成的重投：把事件改回未投递，再分发两次
    await database.query(
      'UPDATE platform.outbox SET dispatched_at = NULL, locked_until = NULL WHERE id = $1',
      [event.eventId],
    );
    await dispatcher.dispatchOnce();
    await database.query(
      'UPDATE platform.outbox SET dispatched_at = NULL, locked_until = NULL WHERE id = $1',
      [event.eventId],
    );
    await dispatcher.dispatchOnce();
    expect(handled).toBe(1);
    expect(await count('SELECT count(*) AS n FROM kernel_test.effects')).toBe(1);

    // 直接调用 processOnce 也一样
    expect(await inbox.processOnce('test.on_registered_once', event.eventId, async () => {})).toBe(
      'duplicate',
    );
  });

  it('订阅者失败：它的写入回滚、不记已处理；按平台时钟退避后重试，成功的订阅者不重复', async () => {
    const { bus, outbox, dispatcher, inbox } = setup();
    let okCalls = 0;
    let flakyCalls = 0;
    bus.subscribe({
      consumer: 'test.on_ok',
      eventType: 'identity.user_registered',
      handle: async () => {
        okCalls += 1;
      },
    });
    bus.subscribe({
      consumer: 'test.on_flaky',
      eventType: 'identity.user_registered',
      handle: async (event, tx) => {
        flakyCalls += 1;
        await tx.query('INSERT INTO kernel_test.effects (event_id, consumer) VALUES ($1, $2)', [
          event.eventId,
          'flaky',
        ]);
        if (flakyCalls === 1) throw new Error('临时故障 sk-weiban-canary-shouldnotleak123');
      },
    });
    const event = await database.transaction((tx) =>
      outbox.publish(tx, 'identity.user_registered', 'identity', payload()),
    );

    expect(await dispatcher.dispatchOnce()).toMatchObject({ failed: 1 });
    expect(await inbox.hasProcessed('test.on_flaky', event.eventId)).toBe(false);
    expect(await count('SELECT count(*) AS n FROM kernel_test.effects')).toBe(0);
    const { rows } = await database.query<{ last_error: string }>(
      'SELECT last_error FROM platform.outbox WHERE id = $1',
      [event.eventId],
    );
    expect(rows[0]?.last_error).not.toContain('sk-weiban-canary');

    // 退避时间未到：不会领取
    expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
    clock.advance(backoffMs(1));
    expect(await dispatcher.dispatchOnce()).toMatchObject({ dispatched: 1 });
    expect(okCalls).toBe(1);
    expect(flakyCalls).toBe(2);
    expect(await count('SELECT count(*) AS n FROM kernel_test.effects')).toBe(1);
  });

  it('一直失败：超过最大次数后放弃（dead），不再领取', async () => {
    const { bus, outbox, dispatcher } = setup();
    bus.subscribe({
      consumer: 'test.on_always_fail',
      eventType: 'identity.user_registered',
      handle: async () => {
        throw new Error('永久故障');
      },
    });
    const event = await database.transaction((tx) =>
      outbox.publish(tx, 'identity.user_registered', 'identity', payload()),
    );
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const summary = await dispatcher.dispatchOnce();
      expect(summary.claimed).toBe(1);
      clock.advance(backoffMs(attempt));
    }
    expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
    expect(
      await count(
        `SELECT count(*) AS n FROM platform.outbox WHERE id = '${event.eventId}' AND dead_at IS NOT NULL`,
      ),
    ).toBe(1);
  });

  it('租约：被领取但进程崩溃的事件，租约过期后可被重新领取', async () => {
    const { outbox, dispatcher } = setup();
    await database.transaction((tx) =>
      outbox.publish(tx, 'identity.user_registered', 'identity', payload()),
    );
    // 模拟另一个进程领取后崩溃：只加了租约，没有处理完
    await database.query(`UPDATE platform.outbox SET locked_until = $1, attempts = 1`, [
      new Date(clock.nowMs() + 60_000),
    ]);
    expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
    clock.advance(60_001);
    expect((await dispatcher.dispatchOnce()).claimed).toBe(1);
  });

  it('订阅者名必须唯一且符合格式', () => {
    const bus = new EventBus();
    const handle = async () => undefined;
    bus.subscribe({ consumer: 'x.on_y', eventType: 'identity.user_registered', handle });
    expect(() =>
      bus.subscribe({ consumer: 'x.on_y', eventType: 'identity.user_registered', handle }),
    ).toThrow(/重复/);
    expect(() =>
      bus.subscribe({ consumer: 'Bad Name', eventType: 'identity.user_registered', handle }),
    ).toThrow(/不合法/);
  });
});
