import { describe, expect, it } from 'vitest';
import { isMemoryFundingBlock, memoryFailureCode, memoryFundingCheckAt } from './memory-funding.js';

describe('记忆任务资金等待', () => {
  it('保留单次大额和并发短码，只对余额及平台日预算使用资金等待', () => {
    for (const detail of ['request_too_large', 'concurrency_limited']) {
      const reason = memoryFailureCode({ error: 'budget_exceeded', message: detail });
      expect(reason).toBe(detail);
      expect(isMemoryFundingBlock(reason)).toBe(false);
    }
    expect(isMemoryFundingBlock(memoryFailureCode({ error: 'budget_exceeded' }))).toBe(true);
    expect(isMemoryFundingBlock(memoryFailureCode({ error: 'insufficient_balance' }))).toBe(true);
  });

  it('平台预算按北京零时恢复，余额到期只到钱包复查点', () => {
    const now = new Date('2026-10-05T15:58:00.000Z');
    expect(memoryFundingCheckAt('budget_exceeded', now).toISOString()).toBe(
      '2026-10-05T16:00:00.000Z',
    );
    expect(memoryFundingCheckAt('insufficient_balance', now).toISOString()).toBe(
      '2026-10-05T16:13:00.000Z',
    );
  });
});
