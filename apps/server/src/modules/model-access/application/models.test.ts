import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AdminModelWrite } from '@weiban/contracts';
import type { z } from 'zod';
import { ModelAdminService, serviceRatesToYuan, toAdminModel } from './models.js';
import { VOICE_CALL_CASCADE_MODEL_KEY, VOICE_CALL_PIPELINE_TAG } from './voice-call-composite.js';

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
    arenaRanks: vi.fn(async () => ({
      rankOf: () => null,
      rankOfEntry: () => null,
      previousRankOf: () => null,
      previousRankOfEntry: () => null,
    })),
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
  it('clears a manual display multiplier so the base model auto value applies', async () => {
    const { rates, catalog } = fixture();
    const display = {
      setManual: vi.fn(async () => undefined),
      forModels: vi.fn(async () => new Map()),
      invalidate: vi.fn(),
    };
    const svc = new ModelAdminService(
      catalog as never,
      rates as never,
      { nowMs: () => 0 } as never,
      display as never,
    );
    await svc.upsert('admin', key, {
      ...body,
      serviceRates: undefined,
      displayMultiplierManual: null,
    });
    expect(display.setManual).toHaveBeenCalledWith(key, null);
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

const compositeEntry = {
  modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
  displayName: 'Voice Cascade',
  vendorName: 'Weiban',
  upstreamId: '4b1f6a52-0c3d-4e5f-8a9b-0c1d2e3f4a5b',
  upstreamModelId: 'mimo-v2.6-flash',
  capabilities: [],
  tags: [VOICE_CALL_PIPELINE_TAG],
  leaderboardRank: null,
  sortOrder: 0,
  defaultFor: [],
  enabled: true,
  scenarios: ['voice_call'],
  systemMessageMode: 'multi',
  billingBounds: null,
  updatedAt: '2026-10-24T00:00:00.000Z',
  deletedAt: null,
};
const normalEntry = {
  ...compositeEntry,
  modelKey: 'text/other',
  displayName: '普通模型',
  tags: [],
  scenarios: ['chat'],
};

/** 后台列表替身：组合条目的可用性来自流水线三组件，其他条目来自 availabilityDetails。 */
function adminListFixture(input: {
  entries: unknown[];
  details?: Map<string, string>;
  voiceCallAvailability?: unknown;
}) {
  const catalog = {
    adminList: vi.fn(async () => input.entries),
    routes: vi.fn(async () => new Map()),
    availabilityDetails: vi.fn(async () => input.details ?? new Map()),
    voiceCallAvailability: vi.fn(async () => input.voiceCallAvailability),
    arenaRanks: vi.fn(async () => ({
      rankOf: () => null,
      rankOfEntry: () => null,
      previousRankOf: () => null,
      previousRankOfEntry: () => null,
    })),
    usageMissing: vi.fn(async () => new Map()),
  };
  const rates = {
    getActiveTokenRates: vi.fn(async () => new Map()),
    getActiveServiceRates: vi.fn(async () => new Map()),
    getModelDiscounts: vi.fn(async () => new Map()),
  };
  const svc = new ModelAdminService(catalog as never, rates as never, { nowMs: () => 0 } as never);
  return { svc, catalog };
}

describe('ModelAdminService composite availability', () => {
  it('shows the composite available from its three components, ignoring its mirrored upstream and billing bounds', async () => {
    const { svc, catalog } = adminListFixture({
      entries: [compositeEntry, normalEntry],
      details: new Map([
        [VOICE_CALL_CASCADE_MODEL_KEY, 'billing_bounds_missing'],
        ['text/other', 'no_route'],
      ]),
      voiceCallAvailability: {
        available: true,
        pipeline: { asrModelKey: 'asr/x', textModelKey: 'text/x', ttsModelKey: 'tts/x' },
      },
    });
    const models = await svc.list();
    expect(models.find((m) => m.modelKey === VOICE_CALL_CASCADE_MODEL_KEY)?.availability).toEqual({
      available: true,
      detail: null,
    });
    // 非组合条目行为不变：仍按自己的线路 / 计费上限报原因。
    expect(models.find((m) => m.modelKey === 'text/other')?.availability).toEqual({
      available: false,
      detail: 'no_route',
    });
    expect(catalog.voiceCallAvailability).toHaveBeenCalledTimes(1);
  });

  it('reports the failing component instead of its own missing billing bounds', async () => {
    const cases: Array<{ failure: unknown; detail: string }> = [
      {
        failure: {
          reason: 'component_unavailable',
          component: 'tts',
          modelKey: 'tts/mimo',
          detail: 'model_removed',
          upstreamStatus: null,
        },
        detail: 'model_removed',
      },
      {
        failure: {
          reason: 'component_unavailable',
          component: 'asr',
          modelKey: 'asr/sensevoice',
          detail: 'provider_unavailable',
          upstreamStatus: 'invalid',
        },
        detail: 'upstream_invalid_key',
      },
      { failure: { reason: 'pipeline_unconfigured' }, detail: 'no_route' },
    ];
    for (const { failure, detail } of cases) {
      const { svc } = adminListFixture({
        entries: [compositeEntry],
        details: new Map([[VOICE_CALL_CASCADE_MODEL_KEY, 'billing_bounds_missing']]),
        voiceCallAvailability: { available: false, failure },
      });
      const [model] = await svc.list();
      expect(model?.availability).toEqual({ available: false, detail });
    }
  });

  it('marks a disabled composite unavailable without consulting the pipeline', async () => {
    const { svc, catalog } = adminListFixture({
      entries: [{ ...compositeEntry, enabled: false }],
    });
    const [model] = await svc.list();
    expect(model?.availability).toEqual({ available: false, detail: 'model_removed' });
    expect(catalog.voiceCallAvailability).not.toHaveBeenCalled();
  });
});
