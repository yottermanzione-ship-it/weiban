import { describe, expect, it } from 'vitest';
import { SystemClock, TestClock } from './clock.js';

describe('平台时钟', () => {
  it('TestClock 固定时间，可以设置和拨快，不需要真的等待', () => {
    const clock = new TestClock('2026-10-05T08:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-10-05T08:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-10-05T08:01:30.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.nowMs()).toBe(Date.parse('2027-01-01T00:00:00.000Z'));
  });

  it('返回的 Date 被修改不影响时钟', () => {
    const clock = new TestClock('2026-10-05T08:00:00.000Z');
    clock.now().setFullYear(2000);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('SystemClock 读系统时间', () => {
    const before = Date.now();
    const value = new SystemClock().nowMs();
    expect(value).toBeGreaterThanOrEqual(before);
  });
});
