import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { BillingChargeQueryPort, IdentityDirectoryPort } from '@weiban/contracts';
import { AppModule } from '../src/app.module.js';
import {
  DATABASE,
  OUTBOX,
  EVENT_DISPATCHER,
  TestClock,
  newId,
  type Database,
  type Outbox,
  type EventDispatcher,
} from '../src/platform/index.js';
import { IDENTITY_DIRECTORY_PORT, IdentityCommands } from '../src/modules/identity/index.js';
import { LoginThrottle, throttleKey } from '../src/modules/identity/testing.js';
import { BILLING_CHARGE_QUERY_PORT } from '../src/modules/billing/index.js';
import {
  PriceService,
  BillingAdminService,
  ReservationService,
  ReconciliationService,
  BillingLifecycle,
} from '../src/modules/billing/testing.js';
import { UpstreamService, CatalogService } from '../src/modules/model-access/testing.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';
import { describeDb, resetTestDatabase } from './support/db.js';

describeDb('T-028 实际装配与基础缺陷回归', () => {
  let app: INestApplication;
  let db: Database;
  let commands: IdentityCommands;
  let adminId: string;
  const clock = new TestClock('2026-10-05T12:00:00.000Z');
  const modelKey = 'qa/c13';
  beforeAll(async () => {
    await resetTestDatabase();
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          config: testConfig({ BILLING_PLATFORM_DAILY_CAP_MICROS: '50000' }),
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
    adminId = await commands.createAdmin('c13_admin', 'correct horse battery');
  });
  afterAll(async () => {
    await app?.close();
  });

  it('目录查询只返回存在的用户名，批量上限500；只列active管理员', async () => {
    const ordinary = await commands.createAdmin('c13_ordinary', 'correct horse battery');
    await commands.setRole('c13_ordinary', 'user');
    const deleting = await commands.createAdmin('c13_deleting', 'correct horse battery');
    await db.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [deleting]);
    const directory = app.get<IdentityDirectoryPort>(IDENTITY_DIRECTORY_PORT);
    expect(await directory.getUsernames([])).toEqual({});
    expect(await directory.getUsernames([adminId, ordinary, newId()])).toEqual({
      [adminId]: 'c13_admin',
      [ordinary]: 'c13_ordinary',
    });
    await expect(directory.getUsernames(Array(501).fill(adminId))).rejects.toMatchObject({
      code: 'bad_request',
    });
    expect(await directory.listAdminUserIds()).toEqual([adminId]);
  });

  it('Q-010：首次并发五次与十次失败都锁定，乱序键不死锁；解锁后重新计数', async () => {
    const throttle = new LoginThrottle(db, clock);
    for (const count of [5, 10]) {
      const key = throttleKey('username', `c13_parallel_${count}`);
      const ip = throttleKey('ip', `10.23.0.${count}`);
      await Promise.all(
        Array.from({ length: count }, (_, n) =>
          throttle.recordFailure(n % 2 ? [key, ip] : [ip, key]),
        ),
      );
      expect(await throttle.isLocked([key])).toBe(true);
      expect(await throttle.isLocked([ip])).toBe(true);
    }
    clock.advance(16 * 60000);
    const key = throttleKey('username', 'c13_parallel_5');
    await throttle.recordFailure([key]);
    expect(await throttle.isLocked([key])).toBe(false);
  });

  it('真实价格发布→启用模型；价格未发布时拒绝，不用计费查询替身', async () => {
    const fake = createServer((_req, res) => res.writeHead(200).end('{"data":[]}'));
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    try {
      const upstream = await app.get(UpstreamService).create(adminId, {
        name: 'c13 upstream',
        kind: 'openai_compatible',
        baseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`,
        apiKey: 'fake-local-key-c13',
      });
      const body = {
        modelKey,
        displayName: 'C13',
        vendorName: 'QA',
        upstreamId: upstream.upstreamId,
        upstreamModelId: 'c13',
        capabilities: [],
        tags: [],
        leaderboardRank: null,
        sortOrder: 0,
        defaultFor: [],
        enabled: true,
      };
      await expect(app.get(CatalogService).upsert(adminId, modelKey, body)).rejects.toMatchObject({
        code: 'model_unavailable',
      });
      const prices = app.get(PriceService);
      const draft = await prices.createDraft(adminId, {
        versionLabel: 'c13',
        note: null,
        items: [
          {
            modelKey,
            unit: 'input_tokens_per_million',
            priceMicros: 2000000,
            costMicros: 1000000,
            band: null,
          },
          {
            modelKey,
            unit: 'output_tokens_per_million',
            priceMicros: 8000000,
            costMicros: 4000000,
            band: null,
          },
        ],
      });
      await prices.activate(adminId, draft.priceVersionId, null);
      expect((await app.get(CatalogService).upsert(adminId, modelKey, body)).enabled).toBe(true);
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()));
    }
  });

  async function funded(name: string) {
    const id = await commands.createAdmin(name, 'correct horse battery');
    await app.get(BillingAdminService).adjust(adminId, id, {
      direction: 'grant',
      amountMicros: 1000000,
      reason: 'test funding',
      idempotencyKey: newId(),
    });
    return id;
  }
  async function reserve(userId: string, key = newId()) {
    const result = await app.get(ReservationService).estimateAndReserve({
      account: { kind: 'user', userId },
      purpose: 'chat_reply',
      modelKey,
      estimate: { inputTokens: 1000, outputTokens: 1000 },
      idempotencyKey: key,
    });
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  it('Q-011：注销归还active预留，重复注销不再次归还，不误清其他钱包', async () => {
    const user = await funded('c13_purge');
    const other = await funded('c13_keep');
    await reserve(user);
    const keep = await reserve(other);
    const before = await db.query<{ reserved: string }>(
      'SELECT reserved_cost_micros AS reserved FROM billing.platform_daily_budget',
    );
    await app.get(BillingLifecycle).purgeUser(user);
    await app.get(BillingLifecycle).purgeUser(user);
    const after = await db.query<{ reserved: string }>(
      'SELECT reserved_cost_micros AS reserved FROM billing.platform_daily_budget',
    );
    expect(Number(before.rows[0]?.reserved) - Number(after.rows[0]?.reserved)).toBe(5000);
    expect(Number(after.rows[0]?.reserved)).toBe(5000);
    await app.get(ReservationService).release({ holdId: keep.holdId, reason: 'cancelled' });
  });

  it('①③层重跑不覆盖②层；②层先到/后到、重复及乱序均保留最新checkedAt', async () => {
    const service = app.get(ReconciliationService);
    const payload = {
      day: '2026-10-04',
      usageWithoutCharge: 2,
      chargeWithoutUsage: 3,
      amountMismatch: 4,
      snapshotsRepaired: 0,
      checkedAt: '2026-10-05T00:00:00.000Z',
    };
    await db.transaction((tx) => service.applyUsageReconciled(payload, tx));
    const first = await service.run(payload.day);
    expect(first).toMatchObject({
      usageWithoutCharge: 2,
      chargeWithoutUsage: 3,
      usageAmountMismatch: 4,
      usageReconciledAt: payload.checkedAt,
    });
    await db.transaction((tx) =>
      service.applyUsageReconciled(
        { ...payload, amountMismatch: 99, checkedAt: '2026-10-04T23:00:00.000Z' },
        tx,
      ),
    );
    const second = await service.run(payload.day);
    expect(second.runId).toBe(first.runId);
    expect(second.usageAmountMismatch).toBe(4);
    const next = { ...payload, amountMismatch: 0, checkedAt: '2026-10-05T01:00:00.000Z' };
    const outbox = app.get<Outbox>(OUTBOX);
    await db.transaction((tx) =>
      outbox.publish(tx, 'model_access.usage_reconciled', 'model_access', next),
    );
    await app.get<EventDispatcher>(EVENT_DISPATCHER).dispatchOnce(1000);
    expect((await service.list(payload.day, payload.day))[0]?.usageAmountMismatch).toBe(0);
    await service.run('2026-10-03');
    await db.transaction((tx) => service.applyUsageReconciled({ ...next, day: '2026-10-03' }, tx));
    expect((await service.list('2026-10-03', '2026-10-03'))[0]?.usageReconciledAt).toBe(
      next.checkedAt,
    );
  });

  it('扣费记录带upstreamId；按北京日分页，上限及账户用户名正确', async () => {
    const user = await funded('c13_query');
    const upstreamId = newId();
    const usageIds = [];
    for (let n = 0; n < 3; n++) {
      const hold = await reserve(user);
      const usageRecordId = newId();
      usageIds.push(usageRecordId);
      await app.get(ReservationService).settle({
        holdId: hold.holdId,
        usageRecordId,
        actual: { inputTokens: 1000, outputTokens: 1000 },
        startedAt: clock.now().toISOString(),
        upstreamId,
      });
    }
    const query = app.get<BillingChargeQueryPort>(BILLING_CHARGE_QUERY_PORT);
    const first = await query.listChargesByDay('2026-10-05', { limit: 2 });
    const second = await query.listChargesByDay('2026-10-05', {
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    expect([...first.items, ...second.items].map((r) => r.usageRecordId)).toEqual(usageIds);
    expect(second.nextCursor).toBeNull();
    expect((await query.listChargesByDay('2026-10-04')).items).toEqual([]);
    await expect(
      query.getChargesByUsageRecordIds(Array(1001).fill(usageIds[0])),
    ).rejects.toMatchObject({ code: 'bad_request' });
    const rows = await db.query<{ upstream_id: string }>(
      'SELECT upstream_id FROM billing.ledger_entries WHERE usage_record_id = ANY($1::uuid[])',
      [usageIds],
    );
    expect(rows.rows.every((r) => r.upstream_id === upstreamId)).toBe(true);
    expect(
      (await app.get(BillingAdminService).listAccounts()).find((r) => r.userId === user)?.username,
    ).toBe('c13_query');
  });

  it('达到预算80%与对账异常发管理员提醒，载荷无用户名或用户ID', async () => {
    const user = await funded('c13_alert');
    // Previous settled calls cost 15,000; five reservations bring usage to 40,000.
    const reserved = [];
    for (let n = 0; n < 5; n++) reserved.push(await reserve(user));
    const { rows } = await db.query<{ event: { payload: Record<string, unknown> } }>(
      "SELECT event FROM platform.outbox WHERE event_type='platform.admin_alert_raised'",
    );
    expect(rows.some((r) => r.event.payload.kind === 'platform_budget_warning')).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(user);
    expect(JSON.stringify(rows)).not.toContain('c13_alert');
    await db.query('UPDATE billing.accounts SET held_micros=held_micros+1 WHERE user_id=$1', [
      user,
    ]);
    await app.get(ReconciliationService).run('2026-10-05');
    const alerts = await db.query<{ event: { payload: { kind: string } } }>(
      "SELECT event FROM platform.outbox WHERE event_type='platform.admin_alert_raised'",
    );
    expect(alerts.rows.some((r) => r.event.payload.kind === 'reconciliation_flagged')).toBe(true);
    for (const hold of reserved)
      await app.get(ReservationService).release({ holdId: hold.holdId, reason: 'cancelled' });
  });
});
