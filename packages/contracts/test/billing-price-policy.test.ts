import { describe, expect, it } from 'vitest';
import { costPlusPriceMicros } from '../src/http/billing.js';

describe('成本加三成的整数金额', () => {
  it('零成本、整额和不足一微元的结果按统一规则处理', () => {
    expect([0, 1, 2, 3, 10, 4000, 1_234_567].map(costPlusPriceMicros)).toEqual([
      0, 2, 3, 4, 13, 5200, 1_604_938,
    ]);
  });
  it('不经过浮点乘法，超出安全范围或无效成本直接拒绝', () => {
    expect(costPlusPriceMicros(6_000_000_000_000_001)).toBe(7_800_000_000_000_002);
    for (const cost of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      expect(() => costPlusPriceMicros(cost)).toThrow(RangeError);
  });
});
