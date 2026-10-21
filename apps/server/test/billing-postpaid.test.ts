/**
 * 3.27（H1，总经理 10-21）「先用后扣、可欠一次」集成测试（真实 PostgreSQL；没有 TEST_DATABASE_URL 时跳过）。
 * - 余额为正 → 可调用（不冻结积分）；按实际用量全额扣，余额可以变成负数；
 * - 余额 ≤ 0 → 后续付费调用一律拒绝；充值使余额 > 0 后恢复；
 * - 同一用户同时进行的付费调用上限：后台任务直接拒绝，前台排队等待；
 * - 单次预估超过拦截线的异常巨额请求先拦截；
 * - 后台欠费名单。
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ReserveInput } from '@weiban/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import {
  BillingAdminService,
  BillingTestQueries,
  PostpaidSettingsService,
  PriceService,
  ReservationService,
} from '../src/modules/billing/testing.js';
import { DATABASE, TestClock, newId, type Database } from '../src/platform/index.js';
import { describeDb, resetTestDatabase } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const MODEL = 'qa/postpaid';
const PASSWORD = 'correct horse battery';
/** 售价：输入 2 元 / 百万，输出 8 元 / 百万。1000 输入 + 1000 输出 = 10,000 微元（1 积分）。 */
const SMALL = { inputTokens: 1000, outputTokens: 1000 };
/** 线路上限（按旧规则会冻结 232,000 微元）；先用后扣不再按它冻结。 */
const CEILING = {
  usage: { inputTokens: 100_000, outputTokens: 4_000 },
  evidence: 'postpaid-test',
  pricingModels: [MODEL],
};

describeDb('3.27 先用后扣、可欠一次（真实 PostgreSQL）', () => {
  let app: INestApplication;
  let db: Database;
  let commands: IdentityCommands;
  let reservations: ReservationService;
  let settings: PostpaidSettingsService;
  let q: BillingTestQueries;
  let adminId: string;
  let userCounter = 0;
  const clock = new TestClock('2026-10-21T12:00:00.000Z');

  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig(),
          clock,
          logger: captureLogger().logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    db = app.get(DATABASE);
    commands = app.get(IdentityCommands);
    reservations = app.get(ReservationService);
    settings = app.get(PostpaidSettingsService);
    q = new BillingTestQueries(db);
    adminId = await commands.createAdmin('postpaid_admin', PASSWORD);
    const prices = app.get(PriceService);
    const draft = await prices.createDraft(adminId, {
      versionLabel: 'postpaid',
      note: null,
      items: [
        {
          modelKey: MODEL,
          unit: 'input_tokens_per_million',
          priceMicros: 2_000_000,
          costMicros: 1_000_000,
          band: null,
        },
        {
          modelKey: MODEL,
          unit: 'output_tokens_per_million',
          priceMicros: 8_000_000,
          costMicros: 4_000_000,
          band: null,
        },
      ],
    });
    await prices.activate(adminId, draft.priceVersionId, null);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  async function user(balanceMicros: number): Promise<string> {
    userCounter += 1;
    const name = `postpaid_user_${userCounter}`;
    const id = await commands.createAdmin(name, PASSWORD);
    await commands.setRole(name, 'user');
    if (balanceMicros > 0)
      await grant(id, balanceMicros);
    return id;
  }
  function grant(userId: string, amountMicros: number) {
    return app.get(BillingAdminService).adjust(adminId, userId, {
      direction: 'grant',
      amountMicros,
      reason: '测试充值',
      idempotencyKey: newId(),
    });
  }
  function input(userId: string, extra: Partial<ReserveInput> = {}): ReserveInput {
    return {
      account: { kind: 'user', userId },
      purpose: 'chat_reply',
      modelKey: MODEL,
      estimate: SMALL,
      ceiling: CEILING,
      idempotencyKey: newId(),
      ...extra,
    };
  }
  async function reserveOk(i: ReserveInput) {
    const r = await reservations.estimateAndReserve(i);
    if (!r.ok) throw new Error(`冻结失败：${r.error}`);
    return r.value;
  }
  function settle(holdId: string, actual = SMALL) {
    return reservations.settle({
      holdId,
      usageRecordId: newId(),
      actual,
      startedAt: clock.now().toISOString(),
    });
  }
  async function balance(userId: string) {
    const a = await q.account(userId);
    return { balance: Number(a?.balance_micros), held: Number(a?.held_micros) };
  }

  it('余额为正即可调用、不冻结；按实际用量扣成负数后一切付费调用被拒；充值转正后恢复', async () => {
    await settings.update(adminId, {
      maxConcurrentPaidCalls: 3,
      concurrencyWaitSeconds: 0,
      largeRequestLimitPoints: 200,
    });
    const id = await user(5_000); // 0.5 积分，远不够旧规则的 232,000 冻结
    const hold = await reserveOk(input(id));
    expect(hold.amountMicros).toBe(0);
    expect(await balance(id)).toEqual({ balance: 5_000, held: 0 });
    const row = await q.hold(hold.holdId);
    expect(row?.postpaid).toBe(true);
    expect(Number(row?.estimate_micros)).toBe(10_000);

    const settled = await settle(hold.holdId);
    expect(settled.amountMicros).toBe(10_000);
    expect(settled.balanceAfterMicros).toBe(-5_000);
    expect(await balance(id)).toEqual({ balance: -5_000, held: 0 });

    // 欠费：聊天、后台任务都拒绝
    for (const purpose of ['chat_reply', 'memory'] as const) {
      const r = await reservations.estimateAndReserve(input(id, { purpose }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('insufficient_balance');
    }
    // 余额正好 0 也拒绝
    await grant(id, 5_000);
    const zero = await reservations.estimateAndReserve(input(id));
    expect(zero.ok ? null : zero.error).toBe('insufficient_balance');
    // 充值后转正 → 恢复
    await grant(id, 1);
    expect((await reserveOk(input(id))).amountMicros).toBe(0);

    // 后台欠费名单
    const debtor = await user(1_000);
    await settle((await reserveOk(input(debtor))).holdId);
    const debts = await app.get(BillingAdminService).listDebts();
    const item = debts.items.find((d) => d.userId === debtor);
    expect(item?.debtMicros).toBe(9_000);
    expect(item?.debtPoints).toBe(0.9);
    expect(debts.count).toBeGreaterThanOrEqual(1);
    expect(debts.totalDebtMicros).toBeGreaterThanOrEqual(9_000);
  });

  it('并发上限：满了后台任务直接拒绝；结算一笔后可继续；前台排队等到空位', async () => {
    await settings.update(adminId, { maxConcurrentPaidCalls: 2, concurrencyWaitSeconds: 0 });
    const id = await user(10_000_000);
    const a = await reserveOk(input(id));
    await reserveOk(input(id));
    const third = await reservations.estimateAndReserve(input(id, { purpose: 'memory' }));
    expect(third.ok ? null : third.error).toBe('concurrency_limited');
    const chat = await reservations.estimateAndReserve(input(id));
    expect(chat.ok ? null : chat.error).toBe('concurrency_limited');
    await settle(a.holdId);
    await reserveOk(input(id));

    // 前台排队：等待 2 秒内有一笔结算，排队的调用拿到空位
    await settings.update(adminId, { concurrencyWaitSeconds: 2 });
    const busy = await reserveOk(input(id, { idempotencyKey: newId() })).catch(() => null);
    expect(busy).toBeNull(); // 已有 2 笔进行中，等待 2 秒后仍满 → 拒绝
    const { rows } = await db.query<{ id: string }>(
      `SELECT h.id FROM billing.holds h JOIN billing.accounts a ON a.id = h.account_id
        WHERE a.user_id = $1 AND h.status = 'active' AND h.postpaid LIMIT 1`,
      [id],
    );
    const queued = reservations.estimateAndReserve(input(id));
    setTimeout(() => void settle(rows[0]!.id), 400);
    expect((await queued).ok).toBe(true);
    // 后台任务不排队
    const background = await reservations.estimateAndReserve(
      input(id, { purpose: 'memory' }),
    );
    expect(background.ok ? null : background.error).toBe('concurrency_limited');
  });

  it('异常巨额请求按预估拦截；平台账户不受先用后扣规则影响', async () => {
    await settings.update(adminId, {
      maxConcurrentPaidCalls: 10,
      concurrencyWaitSeconds: 0,
      largeRequestLimitPoints: 1, // 10,000 微元
    });
    const id = await user(10_000_000);
    expect((await reserveOk(input(id))).amountMicros).toBe(0); // 正好 1 积分不拦
    const big = await reservations.estimateAndReserve(
      input(id, { estimate: { inputTokens: 2000, outputTokens: 2000 } }),
    );
    expect(big.ok ? null : big.error).toBe('request_too_large');

    const platform = await reservations.estimateAndReserve({
      ...input(id),
      account: { kind: 'platform' },
      estimate: { inputTokens: 2000, outputTokens: 2000 },
    });
    if (platform.ok) {
      const row = await q.hold(platform.value.holdId);
      expect(row?.postpaid).toBe(false);
      expect(platform.value.amountMicros).toBe(232_000);
    } else {
      // 测试配置的平台每日上限太小时只会是 budget_exceeded，不会是先用后扣的拒绝原因
      expect(platform.error).toBe('budget_exceeded');
    }
    await settings.update(adminId, { largeRequestLimitPoints: 200 });
  });
});
