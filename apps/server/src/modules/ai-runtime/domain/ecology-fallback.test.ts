import { describe, expect, it } from 'vitest';
import { ecologyFallback } from './ecology.js';

const answers = (choice: 'act' | 'defer', confidence: number) => [
  { questionId: 'message', choice, confidence },
];

describe('保底阈值随主线改到 3 次', () => {
  it('未回复 2 次时保底仍可触发；3 次时不触发', () => {
    const fallback = ecologyFallback(['message'], answers('defer', 0.9), {
      lateNight: false,
      unansweredCount: 2,
      userActiveInApp30m: false,
    });
    expect(fallback?.action).toBe('message');
    expect(fallback?.score).toBeCloseTo(0.1);
    expect(
      ecologyFallback(['message'], answers('defer', 0.9), {
        lateNight: false,
        unansweredCount: 3,
        userActiveInApp30m: false,
      }),
    ).toBeNull();
  });
});
