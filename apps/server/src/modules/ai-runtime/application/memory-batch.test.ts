/** 批 EJ：记忆整理截断后缩小批次重试，输出上限按条数给。 */
import { describe, expect, it } from 'vitest';
import { memoryOutputTokens, memoryShrink } from './memory.js';

describe('记忆整理批次', () => {
  it('输出上限按条数给、最多 3200；缩小级别受限', () => {
    expect(memoryOutputTokens(0)).toBe(1000);
    expect(memoryOutputTokens(25)).toBe(1600);
    expect(memoryOutputTokens(100)).toBe(3200);
    expect(memoryShrink(undefined)).toBe(0);
    expect(memoryShrink(2)).toBe(2);
    expect(memoryShrink(9)).toBe(3);
    expect(memoryShrink(-1)).toBe(0);
  });
});
