import { describe, expect, it } from 'vitest';
import { hotModelOrder, isDeepSeekModel, profitMargin, type HotOrderEntry } from './hot-order.js';

/** 售价 / 成本按「元 / 百万 token」写，换算成微元。 */
function entry(
  modelKey: string,
  vendorName: string,
  prices?: { sale: [number, number]; cost: [number, number] },
): HotOrderEntry {
  const micros = (yuan: number) => Math.round(yuan * 1_000_000);
  return {
    modelKey,
    vendorName,
    rates: prices && {
      price: {
        inputPerMillionMicros: micros(prices.sale[0]),
        outputPerMillionMicros: micros(prices.sale[1]),
      },
      cost: {
        inputPerMillionMicros: micros(prices.cost[0]),
        outputPerMillionMicros: micros(prices.cost[1]),
      },
    },
  };
}

describe('热门榜顺序（契约 5.1 hotOrder）', () => {
  it('按 1 −（输入成本 + 输出成本）÷（输入售价 + 输出售价）计算利润率，缺价为 null', () => {
    expect(profitMargin(entry('a/x', 'A', { sale: [2, 8], cost: [1, 4] }).rates)).toBeCloseTo(0.5);
    expect(profitMargin(entry('a/x', 'A', { sale: [1, 3], cost: [0.9, 2.7] }).rates)).toBeCloseTo(
      0.1,
    );
    expect(profitMargin(undefined)).toBeNull();
    expect(profitMargin(entry('a/x', 'A', { sale: [0, 0], cost: [0, 0] }).rates)).toBeNull();
  });

  it('按模型键或出品方识别 DeepSeek', () => {
    expect(isDeepSeekModel({ modelKey: 'deepseek/deepseek-v4-pro', vendorName: 'DeepSeek' })).toBe(
      true,
    );
    expect(isDeepSeekModel({ modelKey: 'relay/v4-flash', vendorName: '深度求索' })).toBe(true);
    expect(isDeepSeekModel({ modelKey: 'qwen/qwen3-max', vendorName: '阿里' })).toBe(false);
  });

  it('DeepSeek 置顶：利润率不是最高也排第一；多个 DeepSeek 时取利润率最高的那个，其余照常排序', () => {
    const order = hotModelOrder([
      entry('qwen/qwen3-max', '阿里', { sale: [2, 6], cost: [0.4, 1.2] }), // 80%
      entry('deepseek/deepseek-v4-pro', 'DeepSeek', { sale: [4, 16], cost: [3, 12] }), // 25%
      entry('deepseek/deepseek-v4.1-flash', 'DeepSeek', { sale: [2, 8], cost: [1, 4] }), // 50%
      entry('minimax/m3', 'MiniMax', { sale: [1, 4], cost: [0.6, 2.4] }), // 40%
    ]);
    expect(order).toEqual([
      'deepseek/deepseek-v4.1-flash',
      'qwen/qwen3-max',
      'minimax/m3',
      'deepseek/deepseek-v4-pro',
    ]);
  });

  it('其余模型按利润率从高到低；利润率相同保持目录顺序', () => {
    const order = hotModelOrder([
      entry('a/low', 'A', { sale: [1, 1], cost: [0.9, 0.9] }), // 10%
      entry('b/high', 'B', { sale: [1, 1], cost: [0.2, 0.2] }), // 80%
      entry('c/mid', 'C', { sale: [1, 1], cost: [0.5, 0.5] }), // 50%
      entry('d/mid', 'D', { sale: [2, 2], cost: [1, 1] }), // 50%
    ]);
    expect(order).toEqual(['b/high', 'c/mid', 'd/mid', 'a/low']);
  });

  it('缺价的模型排在最后（含售价为 0 的），DeepSeek 有价时照样置顶', () => {
    const order = hotModelOrder([
      entry('x/no-price', 'X'),
      entry('y/zero', 'Y', { sale: [0, 0], cost: [0, 0] }),
      entry('z/priced', 'Z', { sale: [1, 1], cost: [0.5, 0.5] }),
      entry('deepseek/deepseek-v4-pro', 'DeepSeek', { sale: [1, 1], cost: [0.9, 0.9] }),
    ]);
    expect(order).toEqual(['deepseek/deepseek-v4-pro', 'z/priced', 'x/no-price', 'y/zero']);
  });

  it('DeepSeek 全部缺价时仍置顶（取目录里靠前的），没有 DeepSeek 时纯按利润率', () => {
    expect(
      hotModelOrder([
        entry('z/priced', 'Z', { sale: [1, 1], cost: [0.5, 0.5] }),
        entry('deepseek/a', 'DeepSeek'),
        entry('deepseek/b', 'DeepSeek'),
      ]),
    ).toEqual(['deepseek/a', 'z/priced', 'deepseek/b']);
    expect(
      hotModelOrder([
        entry('x/no-price', 'X'),
        entry('z/priced', 'Z', { sale: [1, 1], cost: [0.5, 0.5] }),
      ]),
    ).toEqual(['z/priced', 'x/no-price']);
  });
});
