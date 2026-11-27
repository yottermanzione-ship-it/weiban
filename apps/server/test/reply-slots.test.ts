import { afterAll, beforeAll, expect, it } from 'vitest';
import { Database, TestClock, newId, withReplySlot } from '../src/platform/index.js';
import { describeDb, requireTestDatabaseUrl, resetTestDatabase } from './support/db.js';

describeDb('三个回复入口共用 PostgreSQL 调度席位', () => {
  let db: Database;
  const clock = new TestClock();
  beforeAll(async () => {
    await resetTestDatabase();
    db = new Database({ url: requireTestDatabaseUrl() });
  });
  afterAll(async () => {
    await db?.close();
  });

  it('三名用户同时提交八个任务，交错取得四席，单账号最多两席，退回的任务全部完成', async () => {
    const users = [newId(), newId(), newId()];
    const ids = [0, 0, 0, 0, 1, 1, 2, 2].map((i) => ({ owner: users[i]!, id: newId() }));
    const done = new Set<string>(),
      pending = [...ids],
      running = new Map<string, { owner: string; release: () => void; finished: Promise<void> }>();
    let peak = 0,
      ownerPeak = 0;
    async function start(item: (typeof ids)[number]) {
      let signal!: () => void;
      const decided = new Promise<void>((r) => {
        signal = r;
      });
      let release!: () => void;
      const hold = new Promise<void>((r) => {
        release = r;
      });
      const finished = withReplySlot(
        db,
        clock,
        item.owner,
        item.id,
        async () => {
          running.set(item.id, { owner: item.owner, release, finished });
          peak = Math.max(peak, running.size);
          ownerPeak = Math.max(
            ownerPeak,
            ...users.map((user) => [...running.values()].filter((r) => r.owner === user).length),
          );
          signal();
          await hold;
          expect(done.has(item.id)).toBe(false);
          done.add(item.id);
        },
        async () => {
          pending.push(item);
          signal();
        },
      );
      await decided;
      clock.advance(125);
    }
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      for (const item of pending.splice(0)) await start(item);
      if (pass === 0)
        expect(new Set([...running.values()].map((r) => r.owner)).size).toBeGreaterThan(1);
      for (const entry of running.values()) entry.release();
      await Promise.all([...running.values()].map((r) => r.finished));
      running.clear();
    }
    expect({ peak, ownerPeak, completed: done.size, left: pending.length }).toEqual({
      peak: 4,
      ownerPeak: 2,
      completed: 8,
      left: 0,
    });
  });

  it('孤儿席位十五秒后可重用；旧持有者迟到释放保留新租约', async () => {
    const owner = newId(),
      first = newId(),
      next = newId();
    let began!: () => void, finish!: () => void;
    const started = new Promise<void>((r) => {
      began = r;
    });
    const held = new Promise<void>((r) => {
      finish = r;
    });
    clock.advance(125);
    const old = withReplySlot(
      db,
      clock,
      owner,
      first,
      async () => {
        began();
        await held;
      },
      async () => {
        throw Error('first slot unavailable');
      },
    );
    await started;
    // 模拟进程静止十五秒，尚未再获得续租机会。
    clock.advance(15_001);
    let obtained!: () => void, release!: () => void;
    const ok = new Promise<void>((r) => {
      obtained = r;
    });
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const newer = withReplySlot(
      db,
      clock,
      owner,
      next,
      async () => {
        obtained();
        await hold;
      },
      async () => {
        throw Error('expired slot unavailable');
      },
    );
    await ok;
    finish();
    await old;
    expect(
      (
        await db.query(
          'SELECT 1 FROM platform.reply_worker_slots WHERE user_id=$1 AND expires_at>$2',
          [owner, clock.now()],
        )
      ).rows,
    ).toHaveLength(1);
    release();
    await newer;
  });
});
