import { describe, expect, it, vi } from 'vitest';
import { SharedSearchBilling } from '../application/shared-search.js';
import { TestClock } from '../../../platform/index.js';

describe('H4 shared billing admission and retry', () => {
  it('never recreates a wallet or admits a deleting user', async () => {
    const service = Object.create(SharedSearchBilling.prototype) as SharedSearchBilling;
    const query = vi.fn(async (_sql: string) => ({ rows: [] })),
      lockUserAccount = vi.fn();
    Object.assign(service, {
      db: { transaction: async (run: (tx: object) => Promise<unknown>) => run({ query }) },
      clock: new TestClock(),
      limits: {
        limits: async () => ({ maxConcurrentPaidCalls: 2, largeRequestLimitMicros: 2000000 }),
      },
      identities: { getAccountStatus: async () => 'deleting' },
      ledger: { lockUserAccount },
      prices: {
        activeVersion: async () => ({ id: 'price' }),
        modelPrices: async () => [
          {
            modelKey: 'search',
            unit: 'search_call',
            priceMicros: 5000,
            costMicros: 5000,
            band: null,
          },
        ],
        discountBp: async () => 10000,
      },
    });
    expect(
      await service.begin({
        key: 'key',
        characterId: 'role',
        modelKey: 'search',
        userIds: ['user'],
      }),
    ).toBeNull();
    expect(lockUserAccount).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT'))).toBe(false);
  });
  it('closed shared settlements are idempotent and bind their supplier usage', async () => {
    const service = Object.create(SharedSearchBilling.prototype) as SharedSearchBilling;
    const postEntry = vi.fn();
    const call = {
      id: 'group',
      character_id: 'role',
      model_key: 'search',
      state: 'settled',
      collected_micros: '200',
      usage_record_id: 'usage',
    };
    const query = async (sql: string) => ({
      rows: sql.includes('SELECT a.user_id')
        ? [{ user_id: 'user', charged_micros: '200' }]
        : sql.includes('SELECT request_key')
          ? [{ request_key: 'key' }]
          : sql.includes('shared_search_calls')
            ? [call]
            : [],
    });
    Object.assign(service, {
      db: { transaction: async (run: (tx: object) => Promise<unknown>) => run({ query }) },
      clock: new TestClock(),
      ledger: { postEntry },
    });
    expect(await service.settle('group', 'usage')).toEqual({
      collectedMicros: 200,
      userCharges: { user: 200 },
    });
    expect(postEntry).not.toHaveBeenCalled();
    await expect(service.settle('group', 'another-usage')).rejects.toThrow('source changed');
  });
});
import { sharedSlice, roundedSharedCharge } from './shared-search.js';

describe('H4 shared search precision', () => {
  it('allocates one total exactly across the original cohort, with no float loss', () => {
    for (const amount of [0, 1, 99, 100, 149, 5000, Number.MAX_SAFE_INTEGER])
      for (const n of [1, 2, 3, 17, 257])
        for (const offset of [0, n - 1]) {
          const parts = Array.from({ length: n }, (_, i) => sharedSlice(amount, n, i, offset));
          expect(parts.reduce((s, x) => s + BigInt(x), 0n)).toBe(BigInt(amount));
          expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        }
  });
  it('accumulates small shares, rounds to 0.01 points, and carries the rounding credit', () => {
    expect(roundedSharedCharge(33, 0)).toEqual({ charge: 0, carry: 33 });
    expect(roundedSharedCharge(33, 33)).toEqual({ charge: 0, carry: 66 });
    expect(roundedSharedCharge(34, 66)).toEqual({ charge: 100, carry: 0 });
    expect(roundedSharedCharge(150, 0)).toEqual({ charge: 200, carry: -50 });
    expect(roundedSharedCharge(50, -50)).toEqual({ charge: 0, carry: 0 });
    let carry = 0,
      charged = 0,
      total = 0;
    for (let i = 0; i < 10000; i++) {
      const value = i % 171;
      total += value;
      const next = roundedSharedCharge(value, carry);
      charged += next.charge;
      carry = next.carry;
      expect(charged + carry).toBe(total);
      expect(next.charge % 100).toBe(0);
    }
  });
  it('a deleted participant does not transfer their share to the survivors', () => {
    expect(sharedSlice(5000, 3, 1)).toBe(1667);
    expect(sharedSlice(5000, 3, 2)).toBe(1666);
    expect(sharedSlice(5000, 3, 1) + sharedSlice(5000, 3, 2)).toBe(3333);
    expect(() => sharedSlice(-1, 3, 0)).toThrow();
    expect(() => roundedSharedCharge(1, 100)).toThrow();
  });
});
import {
  addDays,
  daysBetween,
  localDate,
  nextLocalMidnight,
  safeTimeZone,
  startOfLocalDay,
} from './local-time.js';
import {
  bandCovers,
  categoryOf,
  countsAsBackground,
  priceUsage,
  safetyOverdraftEligible,
  selectPrice,
  validatePriceItems,
  type PriceRow,
} from './rules.js';

const M = 'deepseek/deepseek-v4';
const rows: PriceRow[] = [
  {
    modelKey: M,
    unit: 'input_tokens_per_million',
    band: null,
    priceMicros: 2_000_000,
    costMicros: 1_000_000,
  },
  {
    modelKey: M,
    unit: 'output_tokens_per_million',
    band: null,
    priceMicros: 8_000_000,
    costMicros: 4_000_000,
  },
  {
    modelKey: M,
    unit: 'output_tokens_per_million',
    band: { name: '高峰', weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
    priceMicros: 16_000_000,
    costMicros: 8_000_000,
  },
  { modelKey: M, unit: 'image', band: null, priceMicros: 200_000, costMicros: 150_000 },
  { modelKey: M, unit: 'asr_minute', band: null, priceMicros: 14_000, costMicros: 14_000 },
];

// 2026-10-05 是周一；北京时间 10:00 = UTC 02:00
const MON_PEAK = new Date('2026-10-05T02:00:00Z');
const MON_NIGHT = new Date('2026-10-05T14:00:00Z');
const SAT_PEAK = new Date('2026-10-10T02:00:00Z');

describe('计价 priceUsage（billing.md 4.2）', () => {
  it('按百万 token 计价并向上取整到整数微元；成本价同理', () => {
    const r = priceUsage(rows, { inputTokens: 1000, outputTokens: 500 }, MON_NIGHT, true);
    // 1000 × 2 + 500 × 8 = 6000 微元；成本 1000 + 2000 = 3000
    expect(r).toMatchObject({ ok: true, sellMicros: 6000, costMicros: 3000 });
    const tiny = priceUsage(rows, { inputTokens: 1 }, MON_NIGHT, true);
    expect(tiny).toMatchObject({ ok: true, sellMicros: 2, costMicros: 1 });
    const third = priceUsage(rows, { asrSeconds: 1 }, MON_NIGHT, true); // 14000 / 60 = 233.3 → 234
    expect(third).toMatchObject({ ok: true, sellMicros: 234 });
  });

  it('分时价：工作日高峰取高峰价，其余时段取全天价', () => {
    expect(priceUsage(rows, { outputTokens: 1_000_000 }, MON_PEAK, true)).toMatchObject({
      sellMicros: 16_000_000,
    });
    expect(priceUsage(rows, { outputTokens: 1_000_000 }, MON_NIGHT, true)).toMatchObject({
      sellMicros: 8_000_000,
    });
    expect(priceUsage(rows, { outputTokens: 1_000_000 }, SAT_PEAK, true)).toMatchObject({
      sellMicros: 8_000_000,
    });
  });

  it('跨午夜的时段按开始那天的星期判断', () => {
    const band = { name: '夜间', weekdays: [5], start: '22:00', end: '02:00' };
    expect(bandCovers(band, new Date('2026-10-09T15:00:00Z'))).toBe(true); // 周五 23:00
    expect(bandCovers(band, new Date('2026-10-09T17:00:00Z'))).toBe(true); // 周六 01:00
    expect(bandCovers(band, new Date('2026-10-10T15:00:00Z'))).toBe(false); // 周六 23:00
  });

  it('严格模式下缺价返回 price_missing；结算模式按 0 计并列出缺价单位', () => {
    expect(priceUsage(rows, { searchCalls: 1 }, MON_NIGHT, true)).toMatchObject({
      ok: false,
      missingUnit: 'search_call',
    });
    expect(priceUsage(rows, { searchCalls: 1, images: 2 }, MON_NIGHT, false)).toMatchObject({
      ok: true,
      sellMicros: 400_000,
      unpricedUnits: ['search_call'],
    });
  });

  it('命中缓存的输入没有单独价格时按普通输入价', () => {
    expect(selectPrice(rows, 'cached_input_tokens_per_million', MON_NIGHT)).toBeNull();
    expect(priceUsage(rows, { cachedInputTokens: 1000 }, MON_NIGHT, true)).toMatchObject({
      sellMicros: 2000,
    });
  });

  it('价目表校验：重复、只有时段价没有全天价', () => {
    expect(validatePriceItems(rows)).toEqual([]);
    expect(validatePriceItems([...rows, rows[0] as PriceRow])).toHaveLength(1);
    expect(validatePriceItems([rows[2] as PriceRow])).toHaveLength(1);
  });
});

describe('用途分类（billing.md 5.2、第 7 节、6.6）', () => {
  it('用途 → 用户可见分组', () => {
    expect(categoryOf('chat_reply')).toBe('chat');
    expect(categoryOf('behavior_planning')).toBe('planning');
    expect(categoryOf('safety_followup')).toBe('safety');
    expect(categoryOf('admin_eval')).toBe('admin');
    expect(categoryOf(null)).toBeNull();
  });

  it('后台计入：后台用途总计入、豁免用途永不计入、其他看 countAsBackground', () => {
    expect(countsAsBackground('memory')).toBe(true);
    expect(countsAsBackground('chat_reply')).toBe(false);
    expect(countsAsBackground('behavior_planning', true)).toBe(true);
    expect(countsAsBackground('safety_followup', true)).toBe(false);
    expect(countsAsBackground('safety_check', true)).toBe(false);
  });

  it('H1 已取消旧安全透支特例，兼容函数不能绕过先用后扣准入', () => {
    expect(safetyOverdraftEligible('chat_reply', 'user', true)).toBe(false);
    expect(safetyOverdraftEligible('safety_followup', 'user', true)).toBe(false);
    expect(safetyOverdraftEligible('proactive', 'user', true)).toBe(false);
    expect(safetyOverdraftEligible('memory', 'user', true)).toBe(false);
    expect(safetyOverdraftEligible('chat_reply', 'platform', true)).toBe(false);
    expect(safetyOverdraftEligible('chat_reply', 'user', false)).toBe(false);
  });
});

describe('当地日期', () => {
  it('按时区换算日期、下一次当地零点', () => {
    const t = new Date('2026-10-05T17:30:00Z');
    expect(localDate(t, 'Asia/Shanghai')).toBe('2026-10-06');
    expect(localDate(t, 'America/New_York')).toBe('2026-10-05');
    expect(nextLocalMidnight(t, 'Asia/Shanghai').toISOString()).toBe('2026-10-06T16:00:00.000Z');
    expect(startOfLocalDay('2026-11-01', 'America/New_York').toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-01', '2026-10-05')).toBe(4);
    expect(safeTimeZone('Not/AZone')).toBe('Asia/Shanghai');
  });
});
