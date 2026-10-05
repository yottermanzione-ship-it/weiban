/**
 * billing 模块集成测试（T-023 / D-L0-16，真实 PostgreSQL）。对照任务卡验收标准：
 * 冻结 → 结算多退少补、失败全额解冻、重复结算只扣一次；并发冻结不超额、平台每日上限不被同时突破（Q-007）；
 * 余额被拒后加余额发 balance_restored（Q-008）；安全透支（billing.md 6.6 第 8 条清单）；流水只能追加；
 * 对账发现人为制造的不一致；管理员加扣余额必填原因并写审计；注册赠送（billing.md 8.3）；
 * 以及 identity 契约 1.2 补充（邀请码赠送金额、账号状态端口、注销管理接口）。
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdminLedgerEntry,
  AdminPriceVersion,
  ApiError,
  AuthResponse,
  Invite,
  LedgerEntry,
  PendingAccountDeletion,
  PriceTable,
  ReconciliationRun,
  Wallet,
  type BillingChargeQueryPort,
  type BillingReadPort,
  type BillingReservationPort,
  type DeviceInfo,
  type IdentityAccountStatusPort,
  type ReserveInput,
} from '@weiban/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  BILLING_CHARGE_QUERY_PORT,
  BILLING_READ_PORT,
  BILLING_RESERVATION_PORT,
} from '../src/modules/billing/index.js';
import {
  BillingLifecycle,
  BillingTestQueries,
  ReconciliationService,
  ReservationService,
  SIGNUP_BONUS_REASON,
} from '../src/modules/billing/testing.js';
import { IDENTITY_ACCOUNT_STATUS_PORT, IdentityCommands } from '../src/modules/identity/index.js';
import {
  DATABASE,
  EVENT_DISPATCHER,
  JOB_QUEUE,
  TestClock,
  type Database,
  type EventDispatcher,
  type JobQueue,
} from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase, withClient } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

const MODEL = 'deepseek/deepseek-v4';
const PASSWORD = 'correct horse battery';
const DEVICE: DeviceInfo = {
  platform: 'web',
  name: 'Chrome on Windows',
  appVersion: '0.1.0',
  timeZone: 'Asia/Shanghai',
};
const YUAN = 1_000_000;
/** 估算 1000 输入 + 1000 输出：售价 2 + 8 = 10,000 微元，成本 5,000 微元。 */
const SMALL = { inputTokens: 1000, outputTokens: 1000 };

describeDb('billing 模块（真实 PostgreSQL）', () => {
  let app: INestApplication;
  let baseUrl: string;
  let database: Database;
  let dispatcher: EventDispatcher;
  let port: BillingReservationPort;
  let read: BillingReadPort;
  let status: IdentityAccountStatusPort;
  let reservations: ReservationService;
  let reconciliation: ReconciliationService;
  let lifecycle: BillingLifecycle;
  let commands: IdentityCommands;
  let q: BillingTestQueries;
  let adminToken = '';
  // 北京时间 2026-10-05（周一）20:00，避开价目表测试里的高峰时段
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  const { logger } = captureLogger('warn');
  let ipCounter = 0;
  let userCounter = 0;
  let keyCounter = 0;

  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config,
          clock,
          logger,
          kekRing: testKekRing().ring,
          background: false,
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    database = app.get<Database>(DATABASE);
    dispatcher = app.get<EventDispatcher>(EVENT_DISPATCHER);
    port = app.get<BillingReservationPort>(BILLING_RESERVATION_PORT);
    read = app.get<BillingReadPort>(BILLING_READ_PORT);
    status = app.get<IdentityAccountStatusPort>(IDENTITY_ACCOUNT_STATUS_PORT);
    reservations = app.get(ReservationService);
    reconciliation = app.get(ReconciliationService);
    lifecycle = app.get(BillingLifecycle);
    commands = app.get(IdentityCommands);
    await app.get<JobQueue>(JOB_QUEUE).start();
    q = new BillingTestQueries(database);

    await commands.createAdmin('billing_boss', PASSWORD);
    await refreshAdmin();
    await publishPrices();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // ---------- 小工具 ----------

  function http() {
    ipCounter += 1;
    const ip = `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
    const agent = request(baseUrl);
    const wrap = <T extends { set(k: string, v: string): T }>(r: T, token?: string) => {
      const withIp = r.set('X-Forwarded-For', ip);
      return token ? withIp.set('Authorization', `Bearer ${token}`) : withIp;
    };
    return {
      get: (path: string, token?: string) => wrap(agent.get(path), token),
      post: (path: string, token?: string) => wrap(agent.post(path), token),
      patch: (path: string, token?: string) => wrap(agent.patch(path), token),
      delete: (path: string, token?: string) => wrap(agent.delete(path), token),
    };
  }

  const errorCode = (res: { body: unknown }) => ApiError.parse(res.body).error.code;
  const key = () => `idem-${(keyCounter += 1)}-${clock.nowMs()}`;

  async function dispatchAll(): Promise<void> {
    for (let i = 0; i < 30; i += 1) {
      if ((await dispatcher.dispatchOnce()).claimed === 0) return;
    }
  }

  async function newUser(bonusMicros = 0): Promise<{ userId: string; token: string }> {
    userCounter += 1;
    const username = `payer_${userCounter}`;
    const code = (await commands.createInvite(null, bonusMicros)).code;
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ username, password: PASSWORD, inviteCode: code, device: DEVICE })
      .expect(201);
    const body = AuthResponse.parse(res.body);
    return { userId: body.user.userId, token: body.session.token };
  }

  /** 管理会话 12 小时过期；测试会把时钟拨到后面几天，所以每个用例前（和拨钟之后）按需重新登录。 */
  let adminLoginAt = 0;
  async function refreshAdmin(): Promise<void> {
    if (adminToken && clock.nowMs() - adminLoginAt < 6 * 3_600_000 && clock.nowMs() >= adminLoginAt)
      return;
    adminToken = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .send({ username: 'billing_boss', password: PASSWORD, device: DEVICE, kind: 'admin' })
          .expect(200)
      ).body,
    ).session.token;
    adminLoginAt = clock.nowMs();
  }
  beforeEach(refreshAdmin);

  async function setClock(time: string): Promise<void> {
    clock.set(time);
    await refreshAdmin();
  }

  function grant(userId: string, amountMicros: number, direction = 'grant') {
    return http()
      .post(`/api/v1/admin/billing/accounts/${userId}/adjustments`, adminToken)
      .send({ direction, amountMicros, reason: '测试加余额', idempotencyKey: key() });
  }

  function reserveInput(userId: string, extra: Partial<ReserveInput> = {}): ReserveInput {
    return {
      account: { kind: 'user', userId },
      purpose: 'chat_reply',
      modelKey: MODEL,
      estimate: SMALL,
      idempotencyKey: key(),
      ...extra,
    };
  }

  async function reserveOk(input: ReserveInput) {
    const r = await port.estimateAndReserve(input);
    if (!r.ok) throw new Error(`冻结失败：${r.error}`);
    return r.value;
  }

  async function wallet(token: string) {
    return Wallet.parse((await http().get('/api/v1/billing/wallet', token).expect(200)).body);
  }

  async function events(type: string, userId: string) {
    return withClient(async (c) => {
      const { rows } = await c.query<{ event: { payload: Record<string, unknown> } }>(
        `SELECT event FROM platform.outbox
          WHERE event_type = $1 AND event->'payload'->>'userId' = $2 ORDER BY created_at, id`,
        [type, userId],
      );
      return rows.map((r) => r.event.payload);
    });
  }

  const uuid = () => crypto.randomUUID();

  async function publishPrices() {
    const created = AdminPriceVersion.parse(
      (
        await http()
          .post('/api/v1/admin/billing/price-versions', adminToken)
          .send({
            versionLabel: 'v1',
            note: '首版',
            items: [
              {
                modelKey: MODEL,
                unit: 'input_tokens_per_million',
                priceMicros: 2 * YUAN,
                costMicros: 1 * YUAN,
                band: null,
              },
              {
                modelKey: MODEL,
                unit: 'output_tokens_per_million',
                priceMicros: 8 * YUAN,
                costMicros: 4 * YUAN,
                band: null,
              },
            ],
          })
          .expect(201)
      ).body,
    );
    await http()
      .post(`/api/v1/admin/billing/price-versions/${created.priceVersionId}/activate`, adminToken)
      .send({ effectiveFrom: null })
      .expect(200);
    return created.priceVersionId;
  }

  // ---------- 价目表 ----------

  describe('价目表', () => {
    it('当前价目表对用户只显示售价；已生效版本不可修改（409）；草稿可改；不能预约将来生效（400）', async () => {
      const user = await newUser();
      const table = PriceTable.parse(
        (await http().get('/api/v1/billing/prices', user.token).expect(200)).body,
      );
      expect(table.items).toHaveLength(2);
      expect(JSON.stringify(table)).not.toContain('costMicros');

      const list = (
        await http().get('/api/v1/admin/billing/price-versions', adminToken).expect(200)
      ).body.items as Array<{ priceVersionId: string; status: string }>;
      const active = list.find((v) => v.status === 'active');
      const res = await http()
        .patch(`/api/v1/admin/billing/price-versions/${active?.priceVersionId}`, adminToken)
        .send({ note: '改一下' })
        .expect(409);
      expect(errorCode(res)).toBe('price_version_immutable');

      const draft = AdminPriceVersion.parse(
        (
          await http()
            .post('/api/v1/admin/billing/price-versions', adminToken)
            .send({ versionLabel: 'v2-draft', note: null, items: [] })
            .expect(201)
        ).body,
      );
      const patched = AdminPriceVersion.parse(
        (
          await http()
            .patch(`/api/v1/admin/billing/price-versions/${draft.priceVersionId}`, adminToken)
            .send({ note: '草稿可改' })
            .expect(200)
        ).body,
      );
      expect(patched.note).toBe('草稿可改');
      await http()
        .post(`/api/v1/admin/billing/price-versions/${draft.priceVersionId}/activate`, adminToken)
        .send({ effectiveFrom: new Date(clock.nowMs() + 3_600_000).toISOString() })
        .expect(400);
      // 重复价格 → 400；普通用户 → 403
      await http()
        .post('/api/v1/admin/billing/price-versions', adminToken)
        .send({
          versionLabel: 'dup',
          note: null,
          items: [
            { modelKey: MODEL, unit: 'image', priceMicros: 1, costMicros: 1, band: null },
            { modelKey: MODEL, unit: 'image', priceMicros: 2, costMicros: 1, band: null },
          ],
        })
        .expect(400);
      await http().get('/api/v1/admin/billing/price-versions', user.token).expect(403);
      await http().get('/api/v1/billing/prices').expect(401);
    });

    it('当前价目表没有该模型 → price_missing，不留冻结', async () => {
      const user = await newUser();
      await grant(user.userId, YUAN).expect(201);
      const r = await port.estimateAndReserve(reserveInput(user.userId, { modelKey: 'x/unknown' }));
      expect(r).toMatchObject({ ok: false, error: 'price_missing' });
      expect((await wallet(user.token)).heldMicros).toBe(0);
    });
  });

  // ---------- 冻结 / 结算 / 解冻 ----------

  describe('冻结 → 结算 / 解冻', () => {
    it('钱包按需创建：新用户 GET /billing/wallet 返回余额 0 与默认设置', async () => {
      const user = await newUser();
      const w = await wallet(user.token);
      expect(w).toMatchObject({ balanceMicros: 0, heldMicros: 0, availableMicros: 0 });
      expect(w.lowBalanceThresholdMicros).toBe(5 * YUAN);
      expect(w.backgroundBudget).toMatchObject({ dailyLimitMicros: 3 * YUAN, spentTodayMicros: 0 });
      // 北京时间次日 0 点
      expect(w.backgroundBudget.resetsAt).toBe('2026-10-05T16:00:00.000Z');
      await http().get('/api/v1/billing/wallet').expect(401);
    });

    it('多退少补；重复结算只扣一次；同一个幂等键重复冻结返回同一个冻结', async () => {
      const user = await newUser();
      await grant(user.userId, YUAN).expect(201);
      const input = reserveInput(user.userId, { characterId: uuid() });
      const hold = await reserveOk(input);
      expect(hold).toMatchObject({ amountMicros: 10_000, usedSafetyOverdraft: false });
      expect(await reserveOk(input)).toEqual(hold); // 幂等
      expect(await wallet(user.token)).toMatchObject({
        heldMicros: 10_000,
        availableMicros: 990_000,
      });

      // 实际少于冻结：退回多冻的部分
      const usageRecordId = uuid();
      const settleInput = {
        holdId: hold.holdId,
        usageRecordId,
        actual: { inputTokens: 1000, outputTokens: 500 },
        startedAt: clock.now().toISOString(),
      };
      const s1 = await port.settle(settleInput);
      expect(s1).toMatchObject({
        amountMicros: 6000,
        costMicros: 3000,
        balanceAfterMicros: 994_000,
      });
      expect(await port.settle(settleInput)).toEqual(s1); // 重复结算只扣一次
      expect(await wallet(user.token)).toMatchObject({
        balanceMicros: 994_000,
        heldMicros: 0,
        availableMicros: 994_000,
      });

      // 实际多于冻结：照常多扣
      const hold2 = await reserveOk(reserveInput(user.userId));
      const s2 = await port.settle({
        holdId: hold2.holdId,
        usageRecordId: uuid(),
        actual: { inputTokens: 1000, outputTokens: 2000 },
        startedAt: clock.now().toISOString(),
      });
      expect(s2.amountMicros).toBe(18_000);
      expect(await wallet(user.token)).toMatchObject({ balanceMicros: 976_000, heldMicros: 0 });
      const charges = (await q.ledgerOf(user.userId)).filter((e) => e.type === 'charge');
      expect(charges).toHaveLength(2);
      // 已结算的冻结不能再用另一条用量记录结算
      await expect(port.settle({ ...settleInput, usageRecordId: uuid() })).rejects.toThrow(
        /已用另一条用量记录结算/,
      );
    });

    it('调用失败：全额解冻、不扣钱；上游仍收费时记平台吸收；重复解冻无副作用', async () => {
      const user = await newUser();
      await grant(user.userId, YUAN).expect(201);
      const hold = await reserveOk(reserveInput(user.userId));
      expect(await port.release({ holdId: hold.holdId, reason: 'call_failed' })).toEqual({
        absorbedCostMicros: 0,
      });
      expect(await wallet(user.token)).toMatchObject({ balanceMicros: YUAN, heldMicros: 0 });

      const hold2 = await reserveOk(reserveInput(user.userId));
      const before = Number((await q.platformAccount())?.balance_micros ?? 0);
      const released = await port.release({
        holdId: hold2.holdId,
        reason: 'call_failed',
        upstreamUsage: { inputTokens: 1000, outputTokens: 100 },
        usageRecordId: uuid(),
        startedAt: clock.now().toISOString(),
      });
      expect(released.absorbedCostMicros).toBe(1400); // 成本价 1000×1 + 100×4
      expect(await port.release({ holdId: hold2.holdId, reason: 'call_failed' })).toEqual(released);
      expect(await wallet(user.token)).toMatchObject({ balanceMicros: YUAN, heldMicros: 0 });
      const userCharges = (await q.ledgerOf(user.userId)).filter((e) => e.type === 'charge');
      expect(userCharges).toHaveLength(0);
      const platform = await q.platformAccount();
      expect(Number(platform?.balance_micros)).toBe(before - 1400);
      const absorbed = (await q.platformLedger()).filter((e) => e.absorbed);
      expect(absorbed.at(-1)).toMatchObject({ type: 'charge', amount_micros: '-1400' });
      // 已解冻的不能再结算
      await expect(
        port.settle({
          holdId: hold2.holdId,
          usageRecordId: uuid(),
          actual: SMALL,
          startedAt: clock.now().toISOString(),
        }),
      ).rejects.toThrow(/已解冻/);
    });

    it('冻结过期：定时清理释放额度、归还平台预算；过期后才来的结算照常扣一次', async () => {
      const user = await newUser();
      await grant(user.userId, YUAN).expect(201);
      const hold = await reserveOk(reserveInput(user.userId));
      clock.advance(11 * 60_000);
      expect(await reservations.expireHolds()).toBeGreaterThanOrEqual(1);
      expect((await q.hold(hold.holdId))?.status).toBe('expired');
      expect((await wallet(user.token)).heldMicros).toBe(0);
      const settled = await port.settle({
        holdId: hold.holdId,
        usageRecordId: uuid(),
        actual: SMALL,
        startedAt: clock.now().toISOString(),
      });
      expect(settled.amountMicros).toBe(10_000);
      expect(await wallet(user.token)).toMatchObject({ balanceMicros: 990_000, heldMicros: 0 });
    });
  });

  // ---------- 并发（Q-007） ----------

  describe('并发', () => {
    it('同一用户 20 个请求同时冻结：只有余额够的 5 个成功，余额不会被扣成负数', async () => {
      const user = await newUser();
      await grant(user.userId, 50_000).expect(201);
      const results = await Promise.all(
        Array.from({ length: 20 }, () => port.estimateAndReserve(reserveInput(user.userId))),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      expect(
        results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'insufficient_balance'),
      ).toBe(true);
      const w = await wallet(user.token);
      expect(w).toMatchObject({ balanceMicros: 50_000, heldMicros: 50_000, availableMicros: 0 });
    });

    it('平台每日上限：多个用户同时冻结，预留 + 已结算永远不超过上限', async () => {
      // 拨到新的一天（北京时间），预先把这一天的上限设小：每次冻结预留成本 5,000，上限 32,000 → 最多 6 个
      await setClock('2026-10-06T12:00:00.000Z');
      await withClient((c) =>
        c.query(
          `INSERT INTO billing.platform_daily_budget (budget_day, cap_micros, settled_cost_micros, reserved_cost_micros)
           VALUES ('2026-10-06', 32000, 0, 0)`,
        ),
      );
      const users = await Promise.all(Array.from({ length: 10 }, () => newUser()));
      for (const u of users) await grant(u.userId, YUAN).expect(201);
      const results = await Promise.all(
        users.flatMap((u) => [
          port.estimateAndReserve(reserveInput(u.userId)),
          port.estimateAndReserve(reserveInput(u.userId)),
        ]),
      );
      const ok = results.filter((r) => r.ok);
      expect(ok).toHaveLength(6);
      expect(
        results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'budget_exceeded'),
      ).toBe(true);
      const budget = await q.platformBudget('2026-10-06');
      expect(Number(budget?.reserved_cost_micros)).toBe(30_000);
      // 被拒的用户钱包没有被冻结
      const held = await Promise.all(users.map(async (u) => (await wallet(u.token)).heldMicros));
      expect(held.reduce((a, b) => a + b, 0)).toBe(60_000);
      // 结算后预留转为已结算；解冻归还预留
      for (const r of ok.slice(0, 3)) {
        if (r.ok) {
          await port.settle({
            holdId: r.value.holdId,
            usageRecordId: uuid(),
            actual: SMALL,
            startedAt: clock.now().toISOString(),
          });
        }
      }
      for (const r of ok.slice(3))
        if (r.ok) await port.release({ holdId: r.value.holdId, reason: 'cancelled' });
      const after = await q.platformBudget('2026-10-06');
      expect(Number(after?.reserved_cost_micros)).toBe(0);
      expect(Number(after?.settled_cost_micros)).toBe(15_000);
      // 达到 80% 时写了审计（通知管理员）
      const alerts = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT target_id FROM platform.audit_log WHERE action = 'platform_budget.alert'`,
            )
          ).rows,
      );
      expect(alerts.map((a) => a.target_id)).toContain('2026-10-06');
    });
  });

  // ---------- 余额事件（Q-008） ----------

  describe('余额事件', () => {
    it('可用余额为正但不够一次冻结 → 被拒；加余额后发 balance_restored(topped_up_after_rejection)', async () => {
      await setClock('2026-10-07T12:00:00.000Z');
      const user = await newUser();
      await grant(user.userId, 5000).expect(201); // 0.005 元，一次冻结要 0.01 元
      await dispatchAll();
      const restoredBefore = (await events('billing.balance_restored', user.userId)).length;
      const r = await port.estimateAndReserve(reserveInput(user.userId));
      expect(r).toMatchObject({ ok: false, error: 'insufficient_balance' });
      expect(await read.getSpendStatus(user.userId)).toMatchObject({
        availableMicros: 5000,
        depleted: false,
        insufficient: true,
      });
      await grant(user.userId, 100_000).expect(201);
      const restored = await events('billing.balance_restored', user.userId);
      expect(restored).toHaveLength(restoredBefore + 1);
      expect(restored.at(-1)).toMatchObject({
        trigger: 'topped_up_after_rejection',
        availableMicros: 105_000,
      });
      expect((await read.getSpendStatus(user.userId)).insufficient).toBe(false);
      // 解冻不发 balance_restored
      const hold = await reserveOk(reserveInput(user.userId));
      await port.release({ holdId: hold.holdId, reason: 'cancelled' });
      expect(await events('billing.balance_restored', user.userId)).toHaveLength(
        restoredBefore + 1,
      );
    });

    it('结算使可用余额从 > 0 变 ≤ 0 → balance_depleted；之后加余额 → crossed_zero；低于提醒线发 balance_low（每天一次）', async () => {
      const user = await newUser();
      await grant(user.userId, 10_000).expect(201);
      const hold = await reserveOk(reserveInput(user.userId));
      await port.settle({
        holdId: hold.holdId,
        usageRecordId: uuid(),
        actual: { inputTokens: 1000, outputTokens: 1500 }, // 14,000 > 10,000
        startedAt: clock.now().toISOString(),
      });
      expect((await wallet(user.token)).balanceMicros).toBe(-4000);
      expect(await events('billing.balance_depleted', user.userId)).toHaveLength(1);
      expect(await events('billing.balance_low', user.userId)).toHaveLength(1);
      expect(await read.getSpendStatus(user.userId)).toMatchObject({
        depleted: true,
        insufficient: true,
      });
      await grant(user.userId, 20_000).expect(201);
      const restored = await events('billing.balance_restored', user.userId);
      expect(restored.at(-1)).toMatchObject({ trigger: 'crossed_zero', availableMicros: 16_000 });
      const changed = await events('billing.balance_changed', user.userId);
      expect(changed.map((e) => e.entryType)).toEqual(['admin_grant', 'charge', 'admin_grant']);
      // 同一天再扣费不再发 balance_low
      const hold2 = await reserveOk(reserveInput(user.userId));
      await port.settle({
        holdId: hold2.holdId,
        usageRecordId: uuid(),
        actual: SMALL,
        startedAt: clock.now().toISOString(),
      });
      expect(await events('billing.balance_low', user.userId)).toHaveLength(1);
    });
  });

  // ---------- 安全优先透支（billing.md 6.6 第 8 条） ----------

  describe('安全优先透支', () => {
    /** 估算 100,000 输出 token：冻结 0.8 元。 */
    const BIG = { outputTokens: 100_000 };

    it('余额 0 时带透支的 chat_reply 冻结成功、流水为负且带标记、写审计；不带时被拒', async () => {
      const user = await newUser();
      const plain = await port.estimateAndReserve(reserveInput(user.userId, { estimate: BIG }));
      expect(plain).toMatchObject({ ok: false, error: 'insufficient_balance' });
      const hold = await reserveOk(
        reserveInput(user.userId, { estimate: BIG, safetyOverdraft: true }),
      );
      expect(hold).toMatchObject({ amountMicros: 800_000, usedSafetyOverdraft: true });
      await port.settle({
        holdId: hold.holdId,
        usageRecordId: uuid(),
        actual: BIG,
        startedAt: clock.now().toISOString(),
      });
      const ledger = await q.ledgerOf(user.userId);
      expect(ledger.at(-1)).toMatchObject({
        type: 'charge',
        amount_micros: '-800000',
        balance_after_micros: '-800000',
        safety_overdraft: true,
      });
      const admin = (
        await http()
          .get(`/api/v1/admin/billing/accounts/${user.userId}/ledger`, adminToken)
          .expect(200)
      ).body.items.map((e: unknown) => AdminLedgerEntry.parse(e));
      expect(admin[0]).toMatchObject({ safetyOverdraft: true, category: 'chat' });
      const audit = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT details FROM platform.audit_log WHERE action = 'safety_overdraft.used' AND target_id = $1`,
              [user.userId],
            )
          ).rows,
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.details).toMatchObject({ holdId: hold.holdId, amountMicros: 800_000 });
    });

    it('后台用途（proactive、memory）带透支：billing 按普通冻结处理 → 余额不足被拒（网关负责返回 bad_request）', async () => {
      const user = await newUser();
      for (const purpose of ['proactive', 'memory'] as const) {
        const r = await port.estimateAndReserve(
          reserveInput(user.userId, { purpose, estimate: BIG, safetyOverdraft: true }),
        );
        expect(r).toMatchObject({ ok: false, error: 'insufficient_balance' });
      }
      // 平台账户也不能透支（平台账户本来就不查余额，但不会被标记为透支）
      const p = await reserveOk({
        account: { kind: 'platform' },
        purpose: 'admin_eval',
        modelKey: MODEL,
        estimate: SMALL,
        idempotencyKey: key(),
        safetyOverdraft: true,
      });
      expect(p.usedSafetyOverdraft).toBe(false);
      await port.release({ holdId: p.holdId, reason: 'cancelled' });
    });

    it('透支到上限后再次被拒；加余额先抵扣，可用余额转正时发 balance_restored', async () => {
      const user = await newUser();
      const a = await reserveOk(
        reserveInput(user.userId, { estimate: BIG, safetyOverdraft: true }),
      );
      const b = await reserveOk(
        reserveInput(user.userId, {
          purpose: 'safety_followup',
          estimate: BIG,
          safetyOverdraft: true,
        }),
      );
      // 第三次：0 − 2.4 元 < −2 元
      const c = await port.estimateAndReserve(
        reserveInput(user.userId, {
          purpose: 'safety_check',
          estimate: BIG,
          safetyOverdraft: true,
        }),
      );
      expect(c).toMatchObject({ ok: false, error: 'insufficient_balance' });
      for (const h of [a, b]) {
        await port.settle({
          holdId: h.holdId,
          usageRecordId: uuid(),
          actual: BIG,
          startedAt: clock.now().toISOString(),
        });
      }
      expect((await wallet(user.token)).balanceMicros).toBe(-1_600_000);
      await grant(user.userId, 3 * YUAN).expect(201);
      expect((await wallet(user.token)).balanceMicros).toBe(1_400_000);
      const restored = await events('billing.balance_restored', user.userId);
      expect(restored.at(-1)).toMatchObject({
        trigger: 'crossed_zero',
        availableMicros: 1_400_000,
      });
    });

    it('平台每日上限已满时，透支冻结同样被拒（budget_exceeded）', async () => {
      await setClock('2026-10-08T12:00:00.000Z');
      await withClient((c) =>
        c.query(
          `INSERT INTO billing.platform_daily_budget (budget_day, cap_micros, settled_cost_micros, reserved_cost_micros)
           VALUES ('2026-10-08', 1000, 1000, 0)`,
        ),
      );
      const user = await newUser();
      const r = await port.estimateAndReserve(
        reserveInput(user.userId, { estimate: BIG, safetyOverdraft: true }),
      );
      expect(r).toMatchObject({ ok: false, error: 'budget_exceeded' });
      expect((await wallet(user.token)).heldMicros).toBe(0);
      await setClock('2026-10-09T12:00:00.000Z');
    });
  });

  // ---------- 后台每日上限 ----------

  it('后台每日上限：后台用途与 countAsBackground 受限，聊天、安全用途不受限', async () => {
    const user = await newUser();
    await grant(user.userId, YUAN).expect(201);
    const w = Wallet.parse(
      (
        await http()
          .patch('/api/v1/billing/wallet/settings', user.token)
          .send({ backgroundDailyLimitMicros: 15_000 })
          .expect(200)
      ).body,
    );
    expect(w.backgroundBudget.dailyLimitMicros).toBe(15_000);
    await reserveOk(reserveInput(user.userId, { purpose: 'memory' }));
    expect(
      await port.estimateAndReserve(reserveInput(user.userId, { purpose: 'simulation' })),
    ).toMatchObject({ ok: false, error: 'budget_exceeded' });
    expect(
      await port.estimateAndReserve(
        reserveInput(user.userId, { purpose: 'behavior_planning', countAsBackground: true }),
      ),
    ).toMatchObject({ ok: false, error: 'budget_exceeded' });
    await reserveOk(reserveInput(user.userId, { purpose: 'behavior_planning' }));
    await reserveOk(reserveInput(user.userId, { purpose: 'chat_reply' }));
    await reserveOk(
      reserveInput(user.userId, { purpose: 'safety_followup', countAsBackground: true }),
    );
    expect((await wallet(user.token)).backgroundBudget.spentTodayMicros).toBe(10_000);
    expect((await read.getSpendStatus(user.userId)).backgroundRemainingTodayMicros).toBe(5_000);
    await http()
      .patch('/api/v1/billing/wallet/settings', user.token)
      .send({ backgroundDailyLimitMicros: -1 })
      .expect(400);
  });

  // ---------- 管理员加 / 扣余额 ----------

  describe('管理员加 / 扣余额', () => {
    it('必须填原因；幂等；扣减不能超过可用余额；写审计；普通用户 403', async () => {
      const user = await newUser();
      const base = `/api/v1/admin/billing/accounts/${user.userId}/adjustments`;
      await http()
        .post(base, adminToken)
        .send({ direction: 'grant', amountMicros: 1000, idempotencyKey: key() })
        .expect(400);
      await http()
        .post(base, adminToken)
        .send({ direction: 'grant', amountMicros: 1000, reason: ' ', idempotencyKey: key() })
        .expect(400);
      const idem = key();
      const body = {
        direction: 'grant',
        amountMicros: 2 * YUAN,
        reason: '月初充值',
        idempotencyKey: idem,
      };
      const first = AdminLedgerEntry.parse(
        (await http().post(base, adminToken).send(body).expect(201)).body,
      );
      const again = AdminLedgerEntry.parse(
        (await http().post(base, adminToken).send(body).expect(201)).body,
      );
      expect(again.entryId).toBe(first.entryId);
      expect(first).toMatchObject({
        type: 'admin_grant',
        amountMicros: 2 * YUAN,
        note: '月初充值',
      });
      const conflict = await http()
        .post(base, adminToken)
        .send({ ...body, amountMicros: 1 })
        .expect(409);
      expect(errorCode(conflict)).toBe('conflict');
      const tooMuch = await http()
        .post(base, adminToken)
        .send({
          direction: 'deduct',
          amountMicros: 3 * YUAN,
          reason: '误操作测试',
          idempotencyKey: key(),
        })
        .expect(422);
      expect(errorCode(tooMuch)).toBe('insufficient_balance');
      await http()
        .post(base, adminToken)
        .send({
          direction: 'deduct',
          amountMicros: YUAN,
          reason: '扣回多加的',
          idempotencyKey: key(),
        })
        .expect(201);
      expect((await wallet(user.token)).balanceMicros).toBe(YUAN);
      await http().post(base, user.token).send(body).expect(403);
      await http()
        .post(`/api/v1/admin/billing/accounts/${uuid()}/adjustments`, adminToken)
        .send({ ...body, idempotencyKey: key() })
        .expect(404);

      const audit = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT action, actor_type, details FROM platform.audit_log
                WHERE target_id = $1 AND action LIKE 'wallet.%' ORDER BY occurred_at, id`,
              [user.userId],
            )
          ).rows,
      );
      expect(audit.map((a) => a.action)).toEqual(['wallet.admin_grant', 'wallet.admin_deduct']);
      expect(audit[0]).toMatchObject({ actor_type: 'admin', details: { reason: '月初充值' } });

      const accounts = (await http().get('/api/v1/admin/billing/accounts', adminToken).expect(200))
        .body.items as Array<{ userId: string; balanceMicros: number }>;
      expect(accounts.find((a) => a.userId === user.userId)?.balanceMicros).toBe(YUAN);
    });
  });

  // ---------- 用户流水与用量汇总 ----------

  it('用户流水分页与筛选；用量汇总按分组', async () => {
    const user = await newUser();
    await grant(user.userId, YUAN).expect(201);
    for (const purpose of ['chat_reply', 'memory', 'behavior_planning'] as const) {
      const h = await reserveOk(reserveInput(user.userId, { purpose }));
      await port.settle({
        holdId: h.holdId,
        usageRecordId: uuid(),
        actual: SMALL,
        startedAt: clock.now().toISOString(),
      });
      clock.advance(1000);
    }
    const page1 = (await http().get('/api/v1/billing/ledger?limit=2', user.token).expect(200)).body;
    expect(page1.items).toHaveLength(2);
    const page2 = (
      await http()
        .get(`/api/v1/billing/ledger?limit=2&cursor=${page1.nextCursor}`, user.token)
        .expect(200)
    ).body;
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items].map((e: unknown) => LedgerEntry.parse(e));
    expect(all.map((e) => e.category)).toEqual(['planning', 'background', 'chat', null]);
    expect(JSON.stringify(all)).not.toContain('costMicros');
    const topups = (await http().get('/api/v1/billing/ledger?type=topup', user.token).expect(200))
      .body;
    expect(topups.items).toHaveLength(1);
    const today = '2026-10-09';
    const summary = (
      await http()
        .get(`/api/v1/billing/usage-summary?from=${today}&to=${today}&groupBy=category`, user.token)
        .expect(200)
    ).body;
    expect(summary.totalMicros).toBe(30_000);
    expect(summary.rows).toEqual([
      { key: 'background', amountMicros: 10_000, calls: 1 },
      { key: 'chat', amountMicros: 10_000, calls: 1 },
      { key: 'planning', amountMicros: 10_000, calls: 1 },
    ]);
    const byDay = (
      await http()
        .get(`/api/v1/billing/usage-summary?from=${today}&to=${today}&groupBy=day`, user.token)
        .expect(200)
    ).body;
    expect(byDay.rows).toEqual([{ key: today, amountMicros: 30_000, calls: 3 }]);
    await http().get('/api/v1/billing/ledger?cursor=garbage', user.token).expect(400);
  });

  // ---------- 流水只增不改 ----------

  it('流水只能追加：直接 UPDATE / DELETE / TRUNCATE 被数据库拒绝', async () => {
    const user = await newUser();
    await grant(user.userId, YUAN).expect(201);
    const [entry] = await q.ledgerOf(user.userId);
    await withClient(async (c) => {
      await expect(
        c.query(`UPDATE billing.ledger_entries SET amount_micros = 1 WHERE id = $1`, [entry?.id]),
      ).rejects.toThrow(/只增不改/);
      await expect(
        c.query(`DELETE FROM billing.ledger_entries WHERE id = $1`, [entry?.id]),
      ).rejects.toThrow(/只增不改/);
      await expect(c.query(`TRUNCATE billing.ledger_entries CASCADE`)).rejects.toThrow(/只增不改/);
      // 删除账户时级联删流水也被拒（只有删除清单函数能删）
      await expect(
        c.query(`DELETE FROM billing.accounts WHERE user_id = $1`, [user.userId]),
      ).rejects.toThrow(/只增不改/);
    });
    expect(await q.ledgerOf(user.userId)).toHaveLength(1);
  });

  // ---------- 对账 ----------

  describe('每日对账', () => {
    it('期初 + 收入 − 支出 = 期末；人为制造的不一致、过期未清冻结、上游账单偏差都能发现', async () => {
      // 前面用例留下的未结算冻结：拨过有效期，定时清理会处理掉它们
      clock.advance(11 * 60_000);
      await reservations.expireHolds();
      const clean = await reconciliation.run('2026-10-09');
      expect({ ...clean, details: await reconciliation.details('2026-10-09') }).toMatchObject({
        ledgerConsistent: true,
        staleHolds: 0,
      });

      const user = await newUser();
      await grant(user.userId, YUAN).expect(201);
      const upstreamId = uuid();
      const h = await reserveOk(reserveInput(user.userId));
      // 契约暂无 upstreamId（已提变更申请）；实现已支持，这里按扩展字段传入
      const tagged = {
        holdId: h.holdId,
        usageRecordId: uuid(),
        actual: SMALL,
        startedAt: clock.now().toISOString(),
        upstreamId,
      };
      await reservations.settle(tagged);
      // 余额 = 流水合计：期初 0 + 收入 1 元 − 支出 0.01 元 = 0.99 元
      const ledger = await q.ledgerOf(user.userId);
      expect(ledger.reduce((s, e) => s + Number(e.amount_micros), 0)).toBe(990_000);
      expect(Number((await q.account(user.userId))?.balance_micros)).toBe(990_000);

      // 人为制造不一致：绕过流水直接改账户余额
      await withClient((c) =>
        c.query(
          `UPDATE billing.accounts SET balance_micros = balance_micros + 1 WHERE user_id = $1`,
          [user.userId],
        ),
      );
      // 一个超过 1 小时仍 active 的冻结
      await reserveOk(reserveInput(user.userId));
      clock.advance(2 * 3_600_000);
      // 上游账单：实际 1 元，系统按成本价算出 0.005 元 → 偏差远超 3%
      await http()
        .post('/api/v1/admin/billing/upstream-bills', adminToken)
        .send({
          upstreamId,
          periodStart: '2026-10-09',
          periodEnd: '2026-10-09',
          amountMicros: YUAN,
          note: null,
        })
        .expect(201);

      const run = await reconciliation.run('2026-10-09');
      expect(run.ledgerConsistent).toBe(false);
      expect(run.staleHolds).toBe(1);
      expect(run.upstreamDiffs).toEqual([
        expect.objectContaining({
          upstreamId,
          billedMicros: YUAN,
          computedCostMicros: 5000,
          flagged: true,
        }),
      ]);
      const details = await reconciliation.details('2026-10-09');
      expect(details?.balanceMismatches).toEqual([
        expect.objectContaining({ balanceMicros: 990_001, ledgerSumMicros: 990_000 }),
      ]);
      const listed = (
        await http()
          .get('/api/v1/admin/billing/reconciliation?from=2026-10-01&to=2026-10-31', adminToken)
          .expect(200)
      ).body.items.map((r: unknown) => ReconciliationRun.parse(r));
      expect(listed).toHaveLength(1); // 同一天重跑覆盖
      expect(listed[0]?.ledgerConsistent).toBe(false);
      const audit = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT count(*)::int AS n FROM platform.audit_log WHERE action = 'reconciliation.flagged'`,
            )
          ).rows,
      );
      expect(audit[0]?.n).toBeGreaterThanOrEqual(1);

      // 平台花费按上游汇总
      const summary = (
        await http().get('/api/v1/admin/billing/platform-summary', adminToken).expect(200)
      ).body;
      expect(summary.last30DaysCostByUpstream).toEqual([{ upstreamId, costMicros: 5000 }]);
      expect(summary.dailyCapMicros).toBe(20 * YUAN);

      // 按用量记录 ID 查扣费（对账第 ② 层用的只读方法）
      expect(await reconciliation.chargesByUsage([tagged.usageRecordId])).toEqual([
        expect.objectContaining({ amountMicros: 10_000, costMicros: 5000, absorbed: false }),
      ]);

      // BillingChargeQueryPort（契约 1.3）：按 ID 查、按北京日列出（含分页）、列出有价格的模型键
      const query = app.get<BillingChargeQueryPort>(BILLING_CHARGE_QUERY_PORT);
      const byId = await query.getChargesByUsageRecordIds([tagged.usageRecordId, uuid()]);
      expect(byId).toEqual([
        expect.objectContaining({
          usageRecordId: tagged.usageRecordId,
          amountMicros: 10_000,
          costMicros: 5000,
          absorbed: false,
          chargedAt: clock.now().toISOString(),
        }),
      ]);
      await expect(
        query.getChargesByUsageRecordIds(Array.from({ length: 1001 }, () => uuid())),
      ).rejects.toThrow();
      const beijingDay = new Date(clock.now().getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
      const dayAll = await query.listChargesByDay(beijingDay);
      expect(dayAll.items.map((i) => i.usageRecordId)).toContain(tagged.usageRecordId);
      expect(dayAll.nextCursor).toBeNull();
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const pg = await query.listChargesByDay(beijingDay, { cursor, limit: 1 });
        seen.push(...pg.items.map((i) => i.ledgerEntryId));
        cursor = pg.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual(dayAll.items.map((i) => i.ledgerEntryId));
      expect((await query.listChargesByDay('2000-01-01')).items).toEqual([]);
      expect(await query.listActivePricedModelKeys()).toContain(MODEL);

      // 修好，避免影响后面的用例；清掉过期冻结
      await withClient((c) =>
        c.query(
          `UPDATE billing.accounts SET balance_micros = balance_micros - 1 WHERE user_id = $1`,
          [user.userId],
        ),
      );
      await reservations.expireHolds();
      await setClock('2026-10-10T12:00:00.000Z');
    });

    it('透支过深（低于 −(上限 + 1 元)）的账户被标红', async () => {
      const user = await newUser();
      await grant(user.userId, 1000).expect(201);
      await withClient(async (c) => {
        // 模拟「透支以外的原因」：手工追加一条大额扣费流水并同步余额（只能追加，不能改）
        const { rows } = await c.query(`SELECT id FROM billing.accounts WHERE user_id = $1`, [
          user.userId,
        ]);
        await c.query(
          `INSERT INTO billing.ledger_entries (id, account_id, created_at, type, amount_micros, balance_after_micros,
             idempotency_key, absorbed, safety_overdraft, reason)
           VALUES ($1, $2, now(), 'adjustment', -4001000, -4000000, $3, false, false, '测试')`,
          [uuid(), rows[0]?.id, `test:${uuid()}`],
        );
        await c.query(`UPDATE billing.accounts SET balance_micros = -4000000 WHERE id = $1`, [
          rows[0]?.id,
        ]);
      });
      const run = await reconciliation.run('2026-10-10');
      expect(run.ledgerConsistent).toBe(false);
      const details = await reconciliation.details('2026-10-10');
      expect(details?.overdrawnAccounts.map((a) => a.userId)).toEqual([user.userId]);
      expect(details?.balanceMismatches).toEqual([]);
      // 删掉这个账户，避免影响后面
      await lifecycle.purgeUser(user.userId);
    });
  });

  // ---------- A. 注册赠送（billing.md 8.3） ----------

  describe('A. 注册赠送余额', () => {
    it('带赠送的码注册后余额 = 赠送金额，明细一条「注册赠送」admin_grant；重复投递只记一次', async () => {
      const user = await newUser(3 * YUAN);
      const regs = await events('identity.user_registered', user.userId);
      expect(regs).toEqual([
        { userId: user.userId, signupBonus: { amountMicros: 3 * YUAN, grantedByUserId: null } },
      ]);
      expect(JSON.stringify(regs)).not.toMatch(/inviteCode|code/);
      // 事件处理前：钱包按需创建，余额 0
      expect((await wallet(user.token)).balanceMicros).toBe(0);
      await dispatchAll();
      expect((await wallet(user.token)).balanceMicros).toBe(3 * YUAN);
      const items = (
        await http().get('/api/v1/billing/ledger', user.token).expect(200)
      ).body.items.map((e: unknown) => LedgerEntry.parse(e));
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'admin_grant',
        amountMicros: 3 * YUAN,
        note: SIGNUP_BONUS_REASON,
      });
      const restored = await events('billing.balance_restored', user.userId);
      expect(restored).toEqual([
        { userId: user.userId, availableMicros: 3 * YUAN, trigger: 'crossed_zero' },
      ]);

      // 重复投递：把事件重新标为未投递 → 订阅者被收件箱去重；直接再调一次处理函数 → 幂等键去重
      await withClient((c) =>
        c.query(
          `UPDATE platform.outbox SET dispatched_at = NULL
            WHERE event_type = 'identity.user_registered' AND event->'payload'->>'userId' = $1`,
          [user.userId],
        ),
      );
      await dispatchAll();
      await database.transaction((tx) =>
        lifecycle.onUserRegistered(
          regs[0] as {
            userId: string;
            signupBonus: { amountMicros: number; grantedByUserId: null };
          },
          tx,
        ),
      );
      expect(await q.ledgerOf(user.userId)).toHaveLength(1);
      expect((await wallet(user.token)).balanceMicros).toBe(3 * YUAN);
    });

    it('管理员生成的带赠送的码：流水操作人 = 该管理员；不带赠送的码不写流水', async () => {
      const invite = Invite.parse(
        (
          await http()
            .post('/api/v1/admin/invites', adminToken)
            .send({ expiresInDays: null, bonusMicros: 500_000 })
            .expect(201)
        ).body,
      );
      expect(invite.bonusMicros).toBe(500_000);
      const res = await http()
        .post('/api/v1/auth/register')
        .send({
          username: 'bonus_by_admin',
          password: PASSWORD,
          inviteCode: invite.code,
          device: DEVICE,
        })
        .expect(201);
      const { user } = AuthResponse.parse(res.body);
      await dispatchAll();
      const [entry] = await q.ledgerOf(user.userId);
      const adminId = (
        await withClient((c) =>
          c.query(`SELECT id FROM identity.users WHERE username = 'billing_boss'`),
        )
      ).rows[0]?.id;
      expect(entry).toMatchObject({
        type: 'admin_grant',
        operator_user_id: adminId,
        reason: '注册赠送',
      });

      const plain = await newUser();
      await dispatchAll();
      expect(await q.account(plain.userId)).not.toBeNull(); // 钱包已建
      expect(await q.ledgerOf(plain.userId)).toHaveLength(0);
      expect(await events('identity.user_registered', plain.userId)).toEqual([
        { userId: plain.userId },
      ]);
    });

    it('账号已注销 / 不存在时迟到的注册事件不建钱包、不记流水', async () => {
      const ghost = uuid();
      await database.transaction((tx) =>
        lifecycle.onUserRegistered(
          { userId: ghost, signupBonus: { amountMicros: YUAN, grantedByUserId: null } },
          tx,
        ),
      );
      expect(await q.account(ghost)).toBeNull();

      const user = await newUser(YUAN);
      await http()
        .delete('/api/v1/me', user.token)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(202);
      expect(await status.getAccountStatus(user.userId)).toBe('deleting');
      await database.transaction((tx) =>
        lifecycle.onUserRegistered(
          { userId: user.userId, signupBonus: { amountMicros: YUAN, grantedByUserId: null } },
          tx,
        ),
      );
      expect(await q.account(user.userId)).toBeNull();
    });

    it('赠送金额为负、非整数或超过上限的生成请求被拒（400）', async () => {
      for (const bonusMicros of [-1, 1.5, 1_000_000_001]) {
        await http()
          .post('/api/v1/admin/invites', adminToken)
          .send({ expiresInDays: null, bonusMicros })
          .expect(400);
      }
      const plain = Invite.parse(
        (
          await http()
            .post('/api/v1/admin/invites', adminToken)
            .send({ expiresInDays: 7 })
            .expect(201)
        ).body,
      );
      expect(plain.bonusMicros).toBe(0);
      const list = (await http().get('/api/v1/admin/invites', adminToken).expect(200)).body
        .items as Array<{
        bonusMicros?: number;
      }>;
      expect(list.every((i) => typeof i.bonusMicros === 'number')).toBe(true);
    });
  });

  // ---------- B. identity 补充（契约 1.2） + 删除清单 ----------

  describe('B. 账号状态端口、注销管理接口、billing 删除清单', () => {
    it('账号状态：active / deleting / 不存在为 null', async () => {
      const user = await newUser();
      expect(await status.getAccountStatus(user.userId)).toBe('active');
      expect(await status.getAccountStatus(uuid())).toBeNull();
    });

    it('注销未完成列表、重新触发删除（202 / 404）；billing 删除清单删干净钱包与流水，审计只记哈希与删除时余额', async () => {
      const user = await newUser();
      await grant(user.userId, 1234).expect(201);
      await dispatchAll();
      await http()
        .delete('/api/v1/me', user.token)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(202);

      const list = (
        await http().get('/api/v1/admin/account-deletions', adminToken).expect(200)
      ).body.items.map((i: unknown) => PendingAccountDeletion.parse(i));
      const mine = list.find((i: { userId: string }) => i.userId === user.userId);
      expect(mine).toMatchObject({
        username: expect.stringMatching(/^payer_/),
        lastRetriggeredAt: null,
      });
      // T-027 起 model_access 也登记了删除清单
      expect(mine?.modules).toHaveLength(2);
      expect(mine?.modules).toEqual(
        expect.arrayContaining([
          { module: 'billing', purged: false, deletedRows: null, purgedAt: null },
          { module: 'model_access', purged: false, deletedRows: null, purgedAt: null },
        ]),
      );
      await http().get('/api/v1/admin/account-deletions', user.token).expect(401);

      const retried = PendingAccountDeletion.parse(
        (
          await http()
            .post(`/api/v1/admin/account-deletions/${user.userId}/retry`, adminToken)
            .expect(202)
        ).body,
      );
      expect(retried.lastRetriggeredAt).toBe(clock.now().toISOString());
      await http().post(`/api/v1/admin/account-deletions/${uuid()}/retry`, adminToken).expect(404);

      // 删除任务（pg-boss）执行 billing 的删除清单 → 回报 → 账号删除
      await dispatchAll();
      await vi.waitFor(
        async () => {
          // 重新触发与原事件各投递一次任务，删除清单可能执行两次（第二次删 0 行）；
          // 等 billing 与 model_access（T-027）都回报
          const reported = (await events('platform.user_data_purged', user.userId)).map(
            (e) => (e as { module: string }).module,
          );
          expect(new Set(reported)).toEqual(new Set(['billing', 'model_access']));
        },
        { timeout: 20_000, interval: 200 },
      );
      await dispatchAll();
      expect(await commands.verifyPurged(user.userId)).toEqual(
        expect.arrayContaining([
          { module: 'billing', count: 0 },
          { module: 'identity', count: 0 },
        ]),
      );
      expect(await status.getAccountStatus(user.userId)).toBeNull();
      await http()
        .post(`/api/v1/admin/account-deletions/${user.userId}/retry`, adminToken)
        .expect(404);
      const audit = await withClient(
        async (c) =>
          (
            await c.query(
              `SELECT target_id, details FROM platform.audit_log WHERE action IN ('wallet.purged', 'user.deletion_retriggered')
                ORDER BY occurred_at, id`,
            )
          ).rows,
      );
      expect(audit.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(audit)).not.toContain(user.userId);
      expect(audit.some((a) => a.details?.balanceAtDeletionMicros === 1234)).toBe(true);
      // 重复调用删除清单：返回 0
      expect(await lifecycle.purgeUser(user.userId)).toBe(0);
    });

    it('全部模块已回报时，重新触发直接完成账号删除', async () => {
      const user = await newUser();
      await dispatchAll();
      await http()
        .delete('/api/v1/me', user.token)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(202);
      // 模拟「billing 已回报」但账号删除那一步没执行（例如回报事件处理前进程退出）
      await withClient((c) =>
        c.query(
          `INSERT INTO identity.deletion_progress (user_id, module, deleted_rows, reported_at)
           VALUES ($1, 'billing', 0, now()), ($1, 'model_access', 0, now())`,
          [user.userId],
        ),
      );
      await lifecycle.purgeUser(user.userId);
      const snapshot = PendingAccountDeletion.parse(
        (
          await http()
            .post(`/api/v1/admin/account-deletions/${user.userId}/retry`, adminToken)
            .expect(202)
        ).body,
      );
      expect(snapshot.modules.every((m) => m.purged)).toBe(true);
      expect(await status.getAccountStatus(user.userId)).toBeNull();
    });
  });
});
