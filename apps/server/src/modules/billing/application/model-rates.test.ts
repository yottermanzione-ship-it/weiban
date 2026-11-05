import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ModelRateService } from './model-rates.js';
import { priceItems } from '../infra/db/schema.js';

function fixture(rows: object[] = []) {
  const inserted: object[] = [];
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('FOR UPDATE') ? [{ id: 'active' }] : [],
  }));
  const tx = {
    query,
    db: {
      select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
      insert: (table: unknown) => ({
        values: async (values: object | object[]) => {
          if (table === priceItems) inserted.push(...(Array.isArray(values) ? values : [values]));
        },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
  const transaction = vi.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx));
  const audit = { record: vi.fn() };
  const svc = new ModelRateService(
    { transaction } as never,
    audit as never,
    { now: () => new Date('2026-10-22T00:00:00Z') } as never,
  );
  return { svc, transaction, query, audit, inserted };
}
const input = {
  operatorUserId: 'admin',
  modelKey: 'deepseek/search',
  rates: [{ unit: 'search_call' as const, priceMicros: 5000, costMicros: 4000 }],
};
describe('ModelRateService service pricing', () => {
  it('rejects invalid units, duplicates, fractions and invalid amounts before any transaction', async () => {
    const f = fixture();
    for (const rates of [
      [],
      [input.rates[0], input.rates[0]],
      [{ unit: 'input_tokens_per_million', priceMicros: 1, costMicros: 1 }],
      ...[-1, 1.5, NaN, Infinity, 100_000_000_001].map((costMicros) => [
        { ...input.rates[0], costMicros },
      ]),
    ])
      await expect(f.svc.publishModelServiceRates({ ...input, rates } as never)).rejects.toThrow(
        '整数微元',
      );
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('locks before reading and only replaces submitted model/unit including time bands', async () => {
    const base = { band: null, priceMicros: 5000, costMicros: 4000 };
    const f = fixture([
      { ...base, modelKey: 'deepseek/search', unit: 'search_call' },
      { ...base, modelKey: 'deepseek/search', unit: 'search_call', band: { name: 'peak' } },
      { ...base, modelKey: 'deepseek/search', unit: 'tts_10k_chars' },
      { ...base, modelKey: 'deepseek/search', unit: 'input_tokens_per_million' },
      { ...base, modelKey: 'other/search', unit: 'search_call' },
    ]);
    expect((await f.svc.publishModelServiceRates(input)).published).toBe(true);
    expect(f.query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    expect(f.query.mock.calls[1]?.[0]).toContain('FOR UPDATE');
    expect(f.inserted).toHaveLength(4);
    expect(f.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelKey: 'deepseek/search', unit: 'tts_10k_chars' }),
        expect.objectContaining({ modelKey: 'deepseek/search', unit: 'input_tokens_per_million' }),
        expect.objectContaining({ modelKey: 'other/search', unit: 'search_call' }),
        expect.objectContaining({ modelKey: 'deepseek/search', unit: 'search_call', band: null }),
      ]),
    );
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ replacedTimeBands: true }) }),
      expect.anything(),
    );
  });
  it('does not publish or audit unchanged rates', async () => {
    const f = fixture([
      {
        modelKey: input.modelKey,
        unit: 'search_call',
        band: null,
        priceMicros: 5000,
        costMicros: 4000,
      },
    ]);
    expect(await f.svc.publishModelServiceRates(input)).toEqual({
      priceVersionId: 'active',
      published: false,
    });
    expect(f.inserted).toEqual([]);
    expect(f.audit.record).not.toHaveBeenCalled();
  });
});
