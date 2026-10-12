import { expect, it } from 'vitest';
import { TIME_AWARENESS_CASES } from '../cases/time-awareness.js';
import { evaluateOutput } from '../src/index.js';

it('同一瞬间跨日期时区与固定节日预期由标准时区计算核实', () => {
  const weekday = (index: number) => {
    const { time, timeZone } = TIME_AWARENESS_CASES[index]!.setup;
    return new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'long' }).format(new Date(time!));
  };
  expect(weekday(4)).toBe('星期一');
  expect(weekday(5)).toBe('星期日');
  const holiday = TIME_AWARENESS_CASES[7]!.setup;
  expect(
    new Intl.DateTimeFormat('en-CA', { timeZone: holiday.timeZone }).format(
      new Date(holiday.time!),
    ),
  ).toBe('2026-01-01');
});
it('凌晨关心不等于告别，用户明确睡觉允许晚安但仍需运行证据', () => {
  expect(evaluateOutput(TIME_AWARENESS_CASES[0]!, '怎么还没睡？晚安')).toMatchObject({
    status: 'failed',
  });
  expect(evaluateOutput(TIME_AWARENESS_CASES[0]!, '那我们接着聊')).toMatchObject({
    status: 'needs_review',
  });
  expect(evaluateOutput(TIME_AWARENESS_CASES[3]!, '好，晚安')).toMatchObject({
    status: 'needs_review',
  });
});
it('正确星期字样不能掩盖冲突答案或未布置用户时区', () => {
  const test = TIME_AWARENESS_CASES[4]!;
  const judge = {
    score: 5,
    reviewer: 'fixture-reviewer',
    checks: { correct_local_weekday_without_contradiction: false },
  };
  expect(evaluateOutput(test, '星期一，也可能星期日', judge)).toMatchObject({ status: 'failed' });
  judge.checks.correct_local_weekday_without_contradiction = true;
  expect(evaluateOutput(test, '星期一', judge)).toMatchObject({ status: 'needs_review' });
  expect(
    evaluateOutput(test, '星期一', judge, {
      runtime_clock_prepared: true,
      user_time_zone_prepared: false,
    }),
  ).toMatchObject({ status: 'failed' });
});
