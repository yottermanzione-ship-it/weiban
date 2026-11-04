import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  BillingAdminService,
  ModelRateService,
  PriceService,
  ReservationService,
} from '../src/modules/billing/testing.js';
import { newId } from '../src/platform/index.js';
import { describeDb } from './support/db.js';
import { makeIsolatedApp } from './support/isolated-app.js';

describeDb('成本加三成：新价、旧草稿、历史报价和限时折扣', () => {
  let f: Awaited<ReturnType<typeof makeIsolatedApp>>,
    prices: PriceService,
    rates: ModelRateService,
    operatorUserId: string;
  beforeAll(async () => {
    f = await makeIsolatedApp();
    prices = f.app.get(PriceService);
    rates = f.app.get(ModelRateService);
    operatorUserId = (await f.user('cost_policy_operator')).id;
  }, 120_000);
  afterAll(async () => {
    await f?.close();
  });

  it('新建和修改草稿自动算价，旧草稿首次生效前校正，已生效版本不可修改', async () => {
    const item = {
      modelKey: 'policy/draft',
      unit: 'input_tokens_per_million' as const,
      band: null,
      costMicros: 1000,
      priceMicros: 99_999,
    };
    const draft = await prices.createDraft(operatorUserId, {
      versionLabel: 'policy-draft',
      note: null,
      items: [item],
    });
    expect(draft.items[0]?.priceMicros).toBe(1300);
    const updated = await prices.updateDraft(operatorUserId, draft.priceVersionId, {
      items: [{ ...item, costMicros: 2000 }],
    });
    expect(updated.items[0]?.priceMicros).toBe(2600);
    // 合成旧版本遗留草稿，验证上线前保存的任意售价不能通过激活重新生效。
    await f.db.query('UPDATE billing.price_items SET price_micros=9 WHERE price_version_id=$1', [
      draft.priceVersionId,
    ]);
    const active = await prices.activate(operatorUserId, draft.priceVersionId, null);
    expect(active.items[0]?.priceMicros).toBe(2600);
    await expect(
      prices.updateDraft(operatorUserId, active.priceVersionId, { items: [item] }),
    ).rejects.toThrow('不可修改');
    expect((await prices.activate(operatorUserId, active.priceVersionId, null)).items).toEqual(
      active.items,
    );
  });

  it('模型所有 token 单位、参考成本服务和零成本服务自动定价；相同保存不新建版本', async () => {
    const cost = {
      inputPerMillionMicros: 1000,
      outputPerMillionMicros: 2000,
      cachedInputPerMillionMicros: null,
      cacheWrite5mPerMillionMicros: 1250,
      cacheWrite1hPerMillionMicros: 2000,
    };
    const request = {
      operatorUserId,
      modelKey: 'policy/model',
      cost,
      price: { ...cost, inputPerMillionMicros: 9999 },
    };
    const first = await rates.publishModelTokenRates(request);
    expect((await rates.getActiveTokenRates(['policy/model'])).get('policy/model')?.price).toEqual({
      inputPerMillionMicros: 1300,
      outputPerMillionMicros: 2600,
      cachedInputPerMillionMicros: 1300,
      cacheWrite5mPerMillionMicros: 1625,
      cacheWrite1hPerMillionMicros: 2600,
    });
    expect(await rates.publishModelTokenRates(request)).toEqual({ ...first, published: false });
    const service = {
      operatorUserId,
      modelKey: 'policy/voice',
      rates: [
        { unit: 'tts_10k_chars' as const, priceMicros: 0, costMicros: 4000 },
        { unit: 'asr_minute' as const, priceMicros: 99, costMicros: 0 },
      ],
    };
    const published = await rates.publishModelServiceRates(service);
    expect((await rates.getActiveServiceRates(['policy/voice'])).get('policy/voice')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unit: 'tts_10k_chars', priceMicros: 5200, costMicros: 4000 }),
        expect.objectContaining({ unit: 'asr_minute', priceMicros: 0, costMicros: 0 }),
      ]),
    );
    expect(await rates.publishModelServiceRates(service)).toEqual({
      ...published,
      published: false,
    });
  });

  it('复制当前价目只发布一次，旧请求保留旧报价，折扣保留，旧价目与流水不重写', async () => {
    const modelKey = 'policy/history';
    const draft = await prices.createDraft(operatorUserId, {
      versionLabel: 'old-price',
      note: null,
      items: [
        {
          modelKey,
          unit: 'input_tokens_per_million',
          band: null,
          costMicros: 1000,
          priceMicros: 1300,
        },
      ],
    });
    await prices.activate(operatorUserId, draft.priceVersionId, null);
    // 合成升级前已经生效的任意旧价；只在独立测试库中造历史数据。
    await f.db.query('UPDATE billing.price_items SET price_micros=5000 WHERE price_version_id=$1', [
      draft.priceVersionId,
    ]);
    await rates.setModelDiscount({
      operatorUserId,
      modelKey,
      discount: { rate: 0.5, startsAt: '2026-11-04T00:00:00Z', endsAt: '2026-11-05T00:00:00Z' },
    });
    const user = await f.user('cost_policy_payer');
    await f.app.get(BillingAdminService).adjust(operatorUserId, user.id, {
      direction: 'grant',
      amountMicros: 100_000,
      reason: '本机合成余额',
      idempotencyKey: newId(),
    });
    const reservations = f.app.get(ReservationService);
    const reserve = async () => {
      const result = await reservations.estimateAndReserve({
        account: { kind: 'user', userId: user.id },
        purpose: 'chat_reply',
        modelKey,
        estimate: { inputTokens: 1_000_000 },
        ceiling: {
          usage: { inputTokens: 1_000_000 },
          evidence: 'isolated cost policy test',
          pricingModels: [modelKey],
        },
        idempotencyKey: newId(),
      });
      if (!result.ok) throw new Error('合成调用未获准');
      return result.value.holdId;
    };
    const before = await reserve();
    const publications = await Promise.all([
      prices.publishCostPlusPolicy(),
      prices.publishCostPlusPolicy(),
    ]);
    expect(publications.map((x) => x.changedItems).sort()).toEqual([0, 1]);
    expect(publications[0]?.priceVersionId).toBe(publications[1]?.priceVersionId);
    expect(publications[0]?.priceVersionId).not.toBe(draft.priceVersionId);
    const after = await reserve();
    const settle = (holdId: string) =>
      reservations.settle({
        holdId,
        usageRecordId: newId(),
        actual: { inputTokens: 1_000_000 },
        startedAt: f.clock.now().toISOString(),
      });
    expect(await settle(before)).toMatchObject({ amountMicros: 2500, costMicros: 1000 });
    expect(await settle(after)).toMatchObject({ amountMicros: 650, costMicros: 1000 });
    expect(
      (await prices.list()).find((x) => x.priceVersionId === draft.priceVersionId)?.items[0]
        ?.priceMicros,
    ).toBe(5000);
    const beforeRetry = await f.db.query(
      'SELECT id, amount_micros, price_version_id FROM billing.ledger_entries ORDER BY id',
    );
    expect((await prices.publishCostPlusPolicy()).changedItems).toBe(0);
    const afterRetry = await f.db.query(
      'SELECT id, amount_micros, price_version_id FROM billing.ledger_entries ORDER BY id',
    );
    expect(afterRetry.rows).toEqual(beforeRetry.rows);
  });
});
