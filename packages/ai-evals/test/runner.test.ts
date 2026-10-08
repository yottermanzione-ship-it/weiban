import { expect, it } from 'vitest';
import { L2_CASES } from '../cases/l2.js';
import { evaluateOutput } from '../src/index.js';
it('考题ID唯一且包含15个记忆与20个跨模式人设题；不冒充完整19类评测集', () => {
  expect(new Set(L2_CASES.map((c) => c.id)).size).toBe(L2_CASES.length);
  expect(L2_CASES.filter((c) => c.category === 'memory')).toHaveLength(15);
  expect(L2_CASES.filter((c) => c.category === 'persona')).toHaveLength(20);
});
it('缺人工/评审模型证据的规则匹配只能标待评审；不合规则失败优先', () => {
  const test = L2_CASES[0]!;
  expect(evaluateOutput(test, '你那天吃了麻辣烫。').status).toBe('needs_review');
  expect(evaluateOutput(test, '你吃了寿司', { score: 5, reviewer: 'reviewer' }).status).toBe(
    'failed',
  );
  expect(
    evaluateOutput(test, '你那天吃了麻辣烫。', { score: 4, reviewer: 'reviewer' }).status,
  ).toBe('passed');
  expect(evaluateOutput(test, '麻辣烫', { score: Number.NaN, reviewer: 'reviewer' }).status).toBe(
    'needs_review',
  );
});
