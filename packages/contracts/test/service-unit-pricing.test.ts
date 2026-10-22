import { describe, expect, it } from 'vitest';
import {
  AdminModelWrite,
  ModelServiceRate,
  ModelServiceRateWrite,
  PriceUnit,
  ServicePriceUnit,
} from '../src/index.js';

const serviceRates = AdminModelWrite.shape.serviceRates;
describe('3.36 service-unit pricing contracts', () => {
  it('keeps all existing price units and only permits the five non-token units', () => {
    expect(PriceUnit.options).toHaveLength(10);
    expect(ServicePriceUnit.options).toHaveLength(5);
    for (const unit of ServicePriceUnit.options) {
      expect(ModelServiceRateWrite.parse({ unit, price: 0 })).toEqual({ unit, price: 0 });
      expect(ModelServiceRateWrite.safeParse({ unit, price: 100_000, cost: null }).success).toBe(
        true,
      );
    }
    expect(
      ModelServiceRateWrite.safeParse({ unit: 'input_tokens_per_million', price: 1 }).success,
    ).toBe(false);
  });
  it('requires unique nonempty units only when supplied, with bounded finite money', () => {
    expect(serviceRates.safeParse(undefined).success).toBe(true);
    for (const bad of [
      [],
      null,
      [
        { unit: 'search_call', price: 1 },
        { unit: 'search_call', price: 2 },
      ],
    ])
      expect(serviceRates.safeParse(bad).success).toBe(false);
    for (const price of [-1, 100_001, Infinity, NaN])
      expect(serviceRates.safeParse([{ unit: 'search_call', price }]).success).toBe(false);
    expect(
      serviceRates.safeParse(ServicePriceUnit.options.map((unit) => ({ unit, price: 0.005 })))
        .success,
    ).toBe(true);
  });
  it('accepts time-band flags only on responses', () => {
    expect(
      ModelServiceRate.safeParse({
        unit: 'search_call',
        price: 0.005,
        cost: 0.004,
        hasTimeBands: true,
      }).success,
    ).toBe(true);
    expect(
      ModelServiceRateWrite.safeParse({ unit: 'search_call', price: 0.005, hasTimeBands: true })
        .success,
    ).toBe(false);
  });
});
