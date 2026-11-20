import { describe, it, expect } from 'vitest';
import { TestClock } from '../../../platform/index.js';
import { UpstreamScheduler, reserveAlternateTimeMs } from './scheduler.js';

function scheduler() {
  const clock = new TestClock('2026-11-20T00:00:00Z');
  const s = new UpstreamScheduler(
    {} as never,
    clock,
    {
      get: async () => ({
        perUserConcurrency: 1,
        perUserRpm: null,
        cooldownSeconds: 60,
        failureThreshold: 3,
      }),
    } as never,
    {} as never,
  );
  return { clock, s };
}
describe('线路限流和实时请求排队', () => {
  it('首个429即共享冷却，尊重Retry-After，未给提示则逐步拉长', async () => {
    const { s, clock } = scheduler();
    await s.recordFailure('a', 'rate_limited', 'model', 7000);
    expect(s.isRouteCooling('model', 'a')).toBe(true);
    expect(s.isRouteCooling('other', 'a')).toBe(false);
    clock.advance(6900);
    expect(s.isRouteCooling('model', 'a')).toBe(true);
    clock.advance(200);
    expect(s.isRouteCooling('model', 'a')).toBe(false);
    await s.recordFailure('a', 'rate_limited', 'model');
    clock.advance(2100);
    expect(s.isRouteCooling('model', 'a')).toBe(true);
    clock.advance(2000);
    expect(s.isRouteCooling('model', 'a')).toBe(false);
  });
  it('上游明确为整个账号限流时，该账号下其它模型也等待指定窗口', async () => {
    const { s, clock } = scheduler();
    const candidate = {
      upstreamId: 'a',
      upstreamModelId: 'another',
      baseUrl: 'https://fixture.invalid',
      kind: 'openai_compatible',
      maxConcurrency: null,
      rpmLimit: null,
      probing: false,
    };
    await s.recordFailure('a', 'rate_limited', 'm', 7000, 'account');
    expect(s.canAcquireAccount(candidate)).toBe(false);
    clock.advance(7001);
    expect(s.canAcquireAccount(candidate)).toBe(true);
  });
  it('前台等待者优先拿到释放的同一用户槽，不超并发上限', async () => {
    const { s } = scheduler();
    expect(await s.acquireUser('u')).toBe(true);
    const background = s.acquireUser('u', false, 200),
      foreground = s.acquireUser('u', true, 200);
    await Promise.resolve();
    s.releaseUser('u');
    expect(await foreground).toBe(true);
    expect(await s.acquireUser('u')).toBe(false);
    s.releaseUser('u');
    expect(await background).toBe(true);
    s.releaseUser('u');
  });
  it('跨模型预留必须同时给主路与获准备用留下可用时间', () => {
    expect(reserveAlternateTimeMs(17000, 15000, 8000)).toBe(0);
    expect(reserveAlternateTimeMs(48000, 30000, 8000)).toBe(16000);
    expect(reserveAlternateTimeMs(48000, 8000, 0)).toBe(0);
  });
  it('观察完成用时按线路、模型、用途隔离', () => {
    const { s } = scheduler();
    s.noteDuration('m', 'r', 'memory', 18000);
    expect(s.usefulWindowMs('m', 'r', 'memory')).toBe(18000);
    expect(s.usefulWindowMs('m', 'r', 'chat_reply')).toBe(8000);
  });
});
