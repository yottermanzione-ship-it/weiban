import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AdminModelWrite } from '@weiban/contracts';
import type { z } from 'zod';
import { ModelAdminService, serviceRatesToYuan, toAdminModel } from './models.js';

type Write = z.output<typeof AdminModelWrite>;
const key = 'deepseek/search';
const body = {
  modelKey: key,
  enabled: true,
  capabilities: ['web_search'],
  rates: null,
  serviceRates: [{ unit: 'search_call', price: 0.005 }],
} as Write;
function fixture(servicePort = true) {
  const order: string[] = [];
  const rates = {
    getActiveTokenRates: vi.fn(async () => new Map()),
    getActiveServiceRates: vi.fn(
      async () =>
        new Map([
          [key, [{ unit: 'search_call', priceMicros: 5000, costMicros: 5000, hasTimeBands: true }]],
        ]),
    ),
    publishModelServiceRates: servicePort
      ? vi.fn(async () => {
          order.push('publish');
          return { priceVersionId: 'v', published: true };
        })
      : undefined,
    publishModelTokenRates: vi.fn(),
    getModelDiscounts: vi.fn(async () => new Map()),
  };
  const catalog = {
    validateBillingBounds: vi.fn(),
    upsert: vi.fn(async (_admin: string, _key: string, entry: unknown) => {
      order.push('catalog');
      return entry;
    }),
    routes: vi.fn(async () => new Map()),
    availabilityDetails: vi.fn(async () => new Map()),
    arenaRanks: vi.fn(async () => ({ rankOf: () => null })),
    adminList: vi.fn(async () => [body]),
    usageMissing: vi.fn(async () => new Map()),
  };
  const svc = new ModelAdminService(catalog as never, rates as never, { nowMs: () => 0 } as never);
  return { svc, rates, catalog, order };
}
describe('ModelAdminService service rates', () => {
  it('publishes search-only pricing before enabling the catalog without fake token rates', async () => {
    const { svc, rates, catalog, order } = fixture();
    const saved = await svc.upsert('admin', key, body);
    expect(order).toEqual(['publish', 'catalog']);
    expect(rates.publishModelServiceRates).toHaveBeenCalledWith({
      operatorUserId: 'admin',
      modelKey: key,
      rates: [{ unit: 'search_call', priceMicros: 5000, costMicros: 5000 }],
    });
    expect(rates.publishModelTokenRates).not.toHaveBeenCalled();
    expect(catalog.upsert.mock.calls[0]?.[2]).not.toHaveProperty('serviceRates');
    expect(saved.rates).toBeNull();
    expect(saved.serviceRates).toEqual([
      { unit: 'search_call', price: 0.005, cost: 0.005, hasTimeBands: true },
    ]);
    expect(saved.hasTimeBands).toBe(true);
  });
  it('preserves service prices when omitted and returns service rates on list', async () => {
    const { svc, rates } = fixture();
    await svc.upsert('admin', key, { ...body, serviceRates: undefined });
    expect(rates.publishModelServiceRates).not.toHaveBeenCalled();
    expect((await svc.list())[0]?.serviceRates?.[0]?.unit).toBe('search_call');
  });
  it('defaults null cost to price, while accepting explicit zero cost', async () => {
    const { svc, rates } = fixture();
    await svc.upsert('admin', key, {
      ...body,
      serviceRates: [{ unit: 'search_call', price: 0.005, cost: 0 }],
    });
    expect(rates.publishModelServiceRates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rates: [{ unit: 'search_call', priceMicros: 5000, costMicros: 0 }],
      }),
    );
    await svc.upsert('admin', key, {
      ...body,
      serviceRates: [{ unit: 'search_call', price: 0.005, cost: null }],
    });
    expect(rates.publishModelServiceRates).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rates: [{ unit: 'search_call', priceMicros: 5000, costMicros: 5000 }],
      }),
    );
  });
  it('fails explicitly before writing when the service-price port is unavailable or capability mismatches', async () => {
    const { svc, catalog } = fixture(false);
    await expect(svc.upsert('admin', key, body)).rejects.toThrow('不能忽略');
    expect(catalog.upsert).not.toHaveBeenCalled();
    const f = fixture();
    await expect(f.svc.upsert('admin', key, { ...body, capabilities: [] })).rejects.toThrow(
      '能力不匹配',
    );
    expect(f.rates.publishModelServiceRates).not.toHaveBeenCalled();
    await expect(f.svc.upsert('admin', 'other/key', body)).rejects.toThrow('模型键');
  });
  it('uses precise yuan conversion and combines token/service time-band flags', () => {
    expect(
      serviceRatesToYuan([
        { unit: 'tts_10k_chars', priceMicros: 1, costMicros: 0, hasTimeBands: false },
      ])[0]?.price,
    ).toBe(0.000001);
    expect(
      toAdminModel(body as never, undefined, [], undefined, undefined, 0, {
        serviceRates: [{ unit: 'search_call', price: 1, hasTimeBands: true }],
      }).hasTimeBands,
    ).toBe(true);
  });
});
