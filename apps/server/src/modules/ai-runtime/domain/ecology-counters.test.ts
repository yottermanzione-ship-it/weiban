import { describe, expect, it } from 'vitest';
import type { EcologyActionKey } from '@weiban/contracts';
import {
  MAIN_UNREPLIED_LIMIT,
  absenceGreetedSince,
  chatActionCountAllowed,
  countMainUnreplied,
  greetingDone,
  separateLineDoneToday,
  shouldAutoOff,
  type EcologyRunCount,
} from './ecology-counters.js';

function run(
  actionKey: string | null,
  finishedAtMs: number | null,
  localDate = '2026-10-31',
  localHour: number | null = 12,
): EcologyRunCount {
  return { actionKey, finishedAtMs, localDate, localHour };
}

const T0 = Date.parse('2026-10-28T00:00:00Z');

describe('主线计数：只数主线动作、只数最后用户消息之后', () => {
  it('早安晚安、跟进、纪念日不计入主线', () => {
    const runs = [
      run('greeting', T0 + 1000),
      run('care_follow_up', T0 + 2000),
      run('care_anniversary', T0 + 3000),
      run('message', T0 + 4000),
    ];
    expect(countMainUnreplied(runs, T0)).toBe(1);
  });
  it('用户消息之前的行不算；用户回消息后清零', () => {
    const runs = [run('message', T0 - 1000), run('message', T0 + 1000)];
    expect(countMainUnreplied(runs, T0)).toBe(1);
    expect(countMainUnreplied(runs, T0 + 2000)).toBe(0);
  });
  it('主线动作都计入：语音、表情、拍一拍、链接、心愿', () => {
    const actions: EcologyActionKey[] = [
      'message',
      'voice',
      'photo',
      'sticker',
      'nudge',
      'share_link',
      'play_wish',
    ];
    const runs = actions.map((a, i) => run(a, T0 + (i + 1) * 1000));
    expect(countMainUnreplied(runs, T0)).toBe(actions.length);
  });
  it('久未问候不计入主线，但单独记', () => {
    const runs = [run('message', T0 + 1000), run('care_absence', T0 + 2000)];
    expect(countMainUnreplied(runs, T0)).toBe(1);
    expect(absenceGreetedSince(runs, T0)).toBe(true);
    expect(absenceGreetedSince([run('message', T0 + 1000)], T0)).toBe(false);
  });
});

describe('单独线：各记各的', () => {
  it('早安晚安分开记；当天 0–1 点的晚安也算已发过', () => {
    expect(greetingDone([run('greeting', 1, '2026-10-31', 8)], '2026-10-31')).toEqual({
      morningDone: true,
      eveningDone: false,
    });
    expect(greetingDone([run('greeting', 1, '2026-10-31', 22)], '2026-10-31')).toEqual({
      morningDone: false,
      eveningDone: true,
    });
    expect(greetingDone([run('greeting', 1, '2026-10-31', 0)], '2026-10-31')).toEqual({
      morningDone: false,
      eveningDone: true,
    });
    expect(greetingDone([run('greeting', 1, '2026-10-30', 22)], '2026-10-31')).toEqual({
      morningDone: false,
      eveningDone: false,
    });
  });
  it('纪念日、深夜线各记各的', () => {
    const runs = [run('care_anniversary', 1, '2026-10-31', 12)];
    expect(separateLineDoneToday(runs, 'care_anniversary', '2026-10-31')).toBe(true);
    expect(separateLineDoneToday(runs, 'care_late_night', '2026-10-31')).toBe(false);
    expect(separateLineDoneToday(runs, 'care_anniversary', '2026-10-30')).toBe(false);
  });
});

describe('3 次停发与 3 天自动关', () => {
  it('主线满 3 次挡主线，不挡单独线', () => {
    const counts = { mainUnreplied: MAIN_UNREPLIED_LIMIT, absenceGreeted: false };
    expect(chatActionCountAllowed('message', counts)).toBe(false);
    expect(chatActionCountAllowed('sticker', counts)).toBe(false);
    expect(chatActionCountAllowed('greeting', counts)).toBe(true);
    expect(chatActionCountAllowed('care_follow_up', counts)).toBe(true);
    expect(chatActionCountAllowed('care_anniversary', counts)).toBe(true);
  });
  it('久未问候是 +1：没发过就不挡，发过就挡', () => {
    expect(
      chatActionCountAllowed('care_absence', { mainUnreplied: 3, absenceGreeted: false }),
    ).toBe(true);
    expect(chatActionCountAllowed('care_absence', { mainUnreplied: 3, absenceGreeted: true })).toBe(
      false,
    );
    expect(
      chatActionCountAllowed('care_absence', { mainUnreplied: 0, absenceGreeted: false }),
    ).toBe(true);
  });
  it('自动关只看 72 小时 + 主线满 3 次', () => {
    const now = T0 + 72 * 3600_000;
    expect(shouldAutoOff({ nowMs: now, lastUserAtMs: T0, mainUnreplied: 3 })).toBe(true);
    expect(shouldAutoOff({ nowMs: now - 1, lastUserAtMs: T0, mainUnreplied: 3 })).toBe(false);
    expect(shouldAutoOff({ nowMs: now, lastUserAtMs: T0, mainUnreplied: 2 })).toBe(false);
    expect(shouldAutoOff({ nowMs: now, lastUserAtMs: null, mainUnreplied: 3 })).toBe(false);
  });
  it('连发 3 天早安晚安用户不回，第 3 天必须自动关（单独线发再多也不拖判定）', () => {
    // 单独线行不计入主线：主线已满 3 次的前提下，单独线行数不影响判定输入；
    // 判定只读 lastUserAtMs 与主线次数，这里断言计数口径本身不把单独线算进去。
    const runs = [
      run('message', T0 + 1000),
      run('message', T0 + 2000),
      run('message', T0 + 3000),
      run('greeting', T0 + 4000),
      run('greeting', T0 + 5000),
      run('greeting', T0 + 6000),
    ];
    const main = countMainUnreplied(runs, T0);
    expect(main).toBe(3);
    expect(
      shouldAutoOff({ nowMs: T0 + 72 * 3600_000, lastUserAtMs: T0, mainUnreplied: main }),
    ).toBe(true);
  });
});
