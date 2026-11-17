import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../platform/index.js';
import type { Ledger } from './ledger.js';
import { UsageRefundService } from './usage-refund.js';

function setup(overrides: { absorbed?: boolean; existing?: boolean } = {}) {
  const tx = { marker: 'tx' };
  const charge = {
    id: 'charge-1',
    accountId: 'account-1',
    amountMicros: -1250,
    absorbed: overrides.absorbed ?? false,
    purpose: 'memory',
    modelKey: 'deepseek/deepseek-v4.1-flash',
    characterId: null,
    priceVersionId: null,
    upstreamId: null,
    costMicros: 100,
  };
  const ledger = {
    findChargeByUsage: vi.fn(async () => (overrides.absorbed ? null : charge)),
    findByIdempotencyKey: vi.fn(async () => (overrides.existing ? { id: 'refund-1' } : null)),
    lockAccountById: vi.fn(async () => ({ id: 'account-1' })),
    postEntry: vi.fn(async () => ({})),
  } as unknown as Ledger;
  const db = {
    transaction: async <T>(fn: (value: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as Database;
  return { service: new UsageRefundService(db, ledger), ledger, tx };
}

describe('摘要无效调用的自动退款', () => {
  it('按 usageRecordId 退回原扣费，并写幂等键', async () => {
    const { service, ledger, tx } = setup();
    await service.refundUsage('usage-1', '摘要未入库，自动退回');
    expect(ledger.postEntry).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      expect.objectContaining({
        type: 'refund',
        amountMicros: 1250,
        usageRecordId: 'usage-1',
        idempotencyKey: 'refund:usage:usage-1',
      }),
    );
  });

  it('已退过、或平台已吸收的调用不再退', async () => {
    const again = setup({ existing: true });
    await again.service.refundUsage('usage-1', '重复');
    expect(again.ledger.postEntry).not.toHaveBeenCalled();

    const absorbed = setup({ absorbed: true });
    await absorbed.service.refundUsage('usage-2', '平台吸收');
    expect(absorbed.ledger.postEntry).not.toHaveBeenCalled();
  });
});
