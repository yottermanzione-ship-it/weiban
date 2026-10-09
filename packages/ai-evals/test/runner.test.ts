import { expect, it } from 'vitest';
import { L2_CASES } from '../cases/l2.js';
import { L3_CASES } from '../cases/l3.js';
import { evaluateOutput } from '../src/index.js';
it('推演考题进入真实评测器，缺失事实失败且无独立评审证据不能通过', () => {
  expect(L3_CASES).toHaveLength(14);
  expect(new Set([...L2_CASES, ...L3_CASES].map((c) => c.id)).size).toBe(
    L2_CASES.length + L3_CASES.length,
  );
  const test = L3_CASES[0]!;
  expect(evaluateOutput(test, '今天一直在家休息').status).toBe('failed');
  expect(evaluateOutput(test, '上午组会，下午去超市，晚上看剧').status).toBe('needs_review');
  const followup = L3_CASES[11]!;
  expect(
    evaluateOutput(followup, '在咖啡厅，后来去餐厅', { score: 5, reviewer: 'reviewer' }).status,
  ).toBe('failed');
});
it('考题ID唯一且保留15个原记忆题、5个向量/分层题与20个跨模式人设题', () => {
  expect(new Set(L2_CASES.map((c) => c.id)).size).toBe(L2_CASES.length);
  const memoryIds = L2_CASES.filter((c) => c.category === 'memory').map((c) => c.id);
  expect(memoryIds).toEqual([
    ...Array.from({ length: 15 }, (_, i) => `MEM-L2-${String(i + 1).padStart(3, '0')}`),
    'MEM-VEC-001',
    'MEM-VEC-002',
    'MEM-LAYER-001',
    'MEM-LAYER-002',
    'MEM-LAYER-003',
  ]);
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
