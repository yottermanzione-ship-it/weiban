import { describe, expect, it } from 'vitest';
import {
  AdminModel,
  AdminModelWrite,
  CONTRACT_VERSION,
  ModelServiceRate,
  ModelServiceRateWrite,
  PriceUnit,
  ServicePriceUnit,
} from '../src/index.js';

const serviceRates = AdminModelWrite.shape.serviceRates;
describe('3.36 service-unit pricing contracts', () => {
  it('keeps all existing price units and only permits the eight non-token units (4.6 adds voice_clone)', () => {
    expect(PriceUnit.options).toHaveLength(13);
    expect(ServicePriceUnit.options).toHaveLength(8);
    expect(ServicePriceUnit.options).toContain('audio_input_tokens_per_million');
    expect(ServicePriceUnit.options).toContain('audio_output_tokens_per_million');
    expect(ServicePriceUnit.options).toContain('voice_clone');
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

describe('4.6 voice clone pricing and tolerant service-rate responses', () => {
  it('bumps the minor contract version', () => {
    expect(CONTRACT_VERSION).toBe('4.6');
  });
  it('writes voice_clone as 元 / 个 like any other service unit', () => {
    expect(serviceRates.parse([{ unit: 'voice_clone', price: 0.013, cost: 0.01 }])).toEqual([
      { unit: 'voice_clone', price: 0.013, cost: 0.01 },
    ]);
  });
  it('reads unknown future service units as unsupported instead of rejecting the row', () => {
    expect(ModelServiceRate.parse({ unit: 'voice_design', price: 1 }).unit).toBe('unsupported');
    // Requests stay strict: the placeholder can never be written back.
    expect(ModelServiceRateWrite.safeParse({ unit: 'unsupported', price: 1 }).success).toBe(false);
  });
  it('allows a response row to carry every service unit plus unknown ones', () => {
    const rates = [
      ...ServicePriceUnit.options.map((unit) => ({ unit, price: 1 })),
      { unit: 'voice_design', price: 1 },
    ];
    expect(AdminModel.shape.serviceRates.safeParse(rates).success).toBe(true);
  });
});
