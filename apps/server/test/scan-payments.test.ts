import 'reflect-metadata';
import { generateKeyPairSync, sign, randomUUID, createHash, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import {
  AuthResponse,
  ScanOrder,
  ScanMonitorEndpoints,
  type ScanMonitorReport,
} from '@weiban/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/main.js';
import {
  ScanPaymentService,
  monitorSigningText,
  BillingTestQueries,
  BillingLifecycle,
  MembershipOrderService,
} from '../src/modules/billing/testing.js';
import { IdentityCommands } from '../src/modules/identity/index.js';
import { DATABASE, TestClock, type Database } from '../src/platform/index.js';
import { NestPinoLogger } from '../src/platform/logging/nest-logger.js';
import { describeDb, resetTestDatabase, withClient } from './support/db.js';
import { captureLogger, testConfig, testKekRing } from './support/fixtures.js';

describeDb('扫码支付：真实数据库、设备签名、并发与用户隔离', () => {
  let app: INestApplication, service: ScanPaymentService, database: Database, q: BillingTestQueries;
  let url = '',
    adminId = '',
    adminToken = '',
    deviceId = '',
    image = '';
  const clock = new TestClock('2026-11-08T08:00:00.000Z');
  const { logger, capture } = captureLogger('warn');
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const device = {
    platform: 'web',
    name: 'Synthetic payment test',
    appVersion: '7.6',
    timeZone: 'Asia/Shanghai',
  };
  let counter = 0,
    ip = 0;
  const http = () => request(url);
  const address = () => `10.77.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  async function user() {
    const body = (
      await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', address())
        .send({ username: `scan_${++counter}`, password: 'synthetic-password-only', device })
        .expect(201)
    ).body;
    const auth = AuthResponse.parse(body);
    return { id: auth.user.userId, token: auth.session.token };
  }
  async function signed(event: ScanMonitorReport['event']) {
    const input: ScanMonitorReport = {
      deviceId,
      requestTime: clock.now().toISOString(),
      event,
      signature: '',
    };
    input.signature = sign(
      'sha256',
      Buffer.from(monitorSigningText(input)),
      keys.privateKey,
    ).toString('base64');
    return input;
  }
  const heartbeat = async () =>
    service.report(await signed({ type: 'heartbeat', listenerConnected: true, queued: 0 }));
  async function receipt(
    order: ScanOrder,
    overrides: Partial<Extract<ScanMonitorReport['event'], { type: 'receipt' }>> = {},
  ) {
    return signed({
      type: 'receipt',
      eventId: createHash('sha256').update(randomUUID()).digest('hex'),
      channel: order.channel,
      amountFen: order.amountFen,
      observedAt: clock.now().toISOString(),
      postedAt: clock.now().toISOString(),
      ...overrides,
    });
  }
  async function order(
    userId: string,
    amountFen = 2000 + counter * 100,
    channel: 'wechat' | 'alipay' = 'wechat',
  ) {
    return service.create(userId, {
      clientOrderId: randomUUID(),
      channel,
      purchase: { kind: 'recharge', amountFen },
    });
  }
  beforeAll(async () => {
    await resetTestDatabase();
    const config = testConfig({ HTTP_TRUST_PROXY: 'true' });
    const module = await Test.createTestingModule({
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
    app = module.createNestApplication({ logger: new NestPinoLogger(logger) });
    configureHttpApp(app, config);
    await app.init();
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    database = app.get(DATABASE);
    service = app.get(ScanPaymentService);
    q = new BillingTestQueries(database);
    await app.get(IdentityCommands).createAdmin('scan_admin', 'synthetic-admin-password');
    const auth = AuthResponse.parse(
      (
        await http()
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', address())
          .send({
            username: 'scan_admin',
            password: 'synthetic-admin-password',
            device,
            kind: 'admin',
          })
          .expect(200)
      ).body,
    );
    adminId = auth.user.userId;
    adminToken = auth.session.token;
    expect((await service.options()).enabled).toBe(false);
    const pair = await service.pairCode(adminId, '合成监控');
    deviceId = pair.deviceId;
    const signature = sign(
      'sha256',
      Buffer.from(`wb-pay-pair-v1|${deviceId}|${pair.pairCode}|${publicKey}`),
      keys.privateKey,
    ).toString('base64');
    const pairInput = { deviceId, pairCode: pair.pairCode, publicKey, signature };
    expect(
      (await http().post(ScanMonitorEndpoints.pair.path).send(pairInput).expect(201)).body,
    ).toMatchObject({ active: true });
    expect((await service.devices()).find((d) => d.id === deviceId)?.active).toBe(true);
    await service.pair(pairInput); // response lost, same proof safely retries
    expect(capture.text).not.toContain(pair.pairCode);
    await heartbeat();
    image =
      'data:image/png;base64,' +
      (
        await sharp(randomBytes(200 * 200 * 3), { raw: { width: 200, height: 200, channels: 3 } })
          .png()
          .toBuffer()
      ).toString('base64');
    expect(image.length).toBeGreaterThan(100_000);
    await http()
      .put('/api/v1/admin/scan-payments/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ enabled: true, cutoverConfirmed: true, wechatQr: image, alipayQr: image })
      .expect(200);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('首次设置自动启用，重复申请复用，换机和停用不会被配对重放覆盖', async () => {
    const first = await service.pairCode(adminId, '新手机');
    const again = await service.pairCode(adminId, '新手机');
    expect(first.deviceId).toBe(again.deviceId);
    const pairKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pub = pairKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const input = (p: typeof first) => ({
      deviceId: p.deviceId,
      pairCode: p.pairCode,
      publicKey: pub,
      signature: sign(
        'sha256',
        Buffer.from(`wb-pay-pair-v1|${p.deviceId}|${p.pairCode}|${pub}`),
        pairKeys.privateKey,
      ).toString('base64'),
    });
    await expect(service.pair(input(first))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await service.pair(input(again))).toMatchObject({ active: false });
    expect((await service.devices()).filter((d) => d.active).map((d) => d.id)).toEqual([deviceId]);
    await service.activate(adminId, again.deviceId, true);
    await service.activate(adminId, again.deviceId, false);
    expect(await service.pair(input(again))).toMatchObject({ active: false });
    expect((await service.devices()).filter((d) => d.active)).toHaveLength(0);
    await service.activate(adminId, deviceId, true);
    await heartbeat();
  });

  it('只有管理会话能配置、生成配对码；普通用户不能伪造已付款或看别人订单', async () => {
    const a = await user(),
      b = await user(),
      o = await order(a.id);
    await http()
      .get('/api/v1/admin/scan-payments/settings')
      .set('Authorization', `Bearer ${a.token}`)
      .expect(403);
    await http()
      .post('/api/v1/admin/scan-payments/devices')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'fake' })
      .expect(403);
    await http()
      .get(`/api/v1/billing/scan/orders/${o.id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(404);
    await http()
      .post('/api/v1/billing/scan/orders')
      .set('Authorization', `Bearer ${b.token}`)
      .send({
        clientOrderId: randomUUID(),
        channel: 'wechat',
        purchase: { kind: 'recharge', amountFen: 500, points: 999999 },
      })
      .expect(400);
    await expect(
      service.create(b.id, {
        clientOrderId: randomUUID(),
        channel: 'wechat',
        purchase: { kind: 'recharge', amountFen: 500 },
      }),
    ).resolves.toMatchObject({ points: 500 });
    await service.get(a.id, o.id, true);
  });
  it('微信/支付宝均可到账；一分等于一积分；重复并发上报只记一笔', async () => {
    for (const channel of ['wechat', 'alipay'] as const) {
      const u = await user(),
        o = await order(u.id, 3000, channel),
        event = await receipt(o);
      const results = await Promise.all([
        service.report(event),
        service.report(event),
        service.report(event),
      ]);
      expect(
        results.every(
          (r) => r.status === 'matched' && 'purchaseKind' in r && r.purchaseKind === 'recharge',
        ),
      ).toBe(true);
      const detail = (await service.receipts({ limit: 100 })).items.find(
        (r) => r.orderId === o.id,
      )!;
      expect(detail).toMatchObject({
        purchaseKind: 'recharge',
        purchaseTitle: '积分充值',
        postedAt: clock.now().toISOString(),
      });
      expect((await service.get(u.id, o.id)).status).toBe('paid');
      const entries = (await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge');
      expect(entries).toHaveLength(1);
      expect(Number(entries[0]!.amount_micros)).toBe(o.amountFen * 10000);
      expect(Number((await q.account(u.id))?.bonus_balance_micros)).toBe(0);
      await expect(service.get(u.id, o.id, true)).resolves.toMatchObject({ status: 'paid' });
    }
  });
  it('有金额的可疑通知会显示在后台；即使同渠道同金额有订单也不自动入账，签名防止移除核对标记', async () => {
    for (const reviewReason of [
      'notice_uncertain',
      'notice_multiple_amounts',
      'notice_summary',
    ] as const) {
      await heartbeat();
      const u = await user(),
        o = await order(u.id, 12345, 'alipay');
      const input = await receipt(o, { reviewReason });
      expect(monitorSigningText(input)).toMatch(/^wb-pay-v2\|/);
      const tampered = structuredClone(input);
      if (tampered.event.type === 'receipt') delete tampered.event.reviewReason;
      await http().post(ScanMonitorEndpoints.report.path).send(tampered).expect(401);
      const first = await http().post(ScanMonitorEndpoints.report.path).send(input).expect(201);
      expect(first.body).toMatchObject({ ok: true, status: 'review', purchaseKind: null });
      await http().post(ScanMonitorEndpoints.report.path).send(input).expect(201);
      expect((await service.get(u.id, o.id)).status).toBe('pending');
      expect((await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(0);
      const listed = (
        await http()
          .get('/api/v1/admin/scan-payments/receipts?limit=100')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200)
      ).body;
      const matches = listed.items.filter(
        (r: { eventId: string }) => r.eventId === (input.event as { eventId: string }).eventId,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        channel: 'alipay',
        amountFen: o.amountFen,
        status: 'review',
        reason: reviewReason,
        orderId: null,
      });
      expect(JSON.stringify(listed)).not.toContain('notificationText');
    }
  });
  it('同一金额并发下单分配不同零头，取消后金额仍隔离，不被新订单复用', async () => {
    const users = await Promise.all([user(), user(), user()]);
    const result = await Promise.all(users.map((u) => order(u.id, 6000)));
    expect(new Set(result.map((o) => o.amountFen)).size).toBe(3);
    expect(result.map((o) => o.points).sort()).toEqual([5998, 5999, 6000]);
    await service.get(users[0]!.id, result[0]!.id, true);
    const retry = await order(users[0]!.id, 6000);
    expect(result.map((o) => o.amountFen)).not.toContain(retry.amountFen);
    const lowTierUsers = await Promise.all([user(), user()]);
    const lowTier = await Promise.all(lowTierUsers.map((u) => order(u.id, 500, 'alipay')));
    expect(lowTier.map((o) => o.amountFen).sort()).toEqual([499, 500]);
    expect(lowTier.map((o) => o.points).sort()).toEqual([499, 500]);
  });
  it('请求响应丢失后重试取回同一订单，不接受同编号换购买内容', async () => {
    const u = await user(),
      input = {
        clientOrderId: randomUUID(),
        channel: 'alipay' as const,
        purchase: { kind: 'recharge' as const, amountFen: 8888 },
      };
    const first = await service.create(u.id, input);
    expect((await service.create(u.id, input)).id).toBe(first.id);
    await expect(
      service.create(u.id, { ...input, purchase: { kind: 'recharge', amountFen: 8889 } }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('设备签名绑定渠道、金额、时刻，禁用设备不能上报', async () => {
    const u = await user(),
      o = await order(u.id),
      input = await receipt(o);
    const tampered = { ...input, event: { ...input.event, amountFen: 1 } } as ScanMonitorReport;
    await expect(service.report(tampered)).rejects.toMatchObject({ code: 'unauthenticated' });
    await service.activate(adminId, deviceId, false);
    await expect(service.report(input)).rejects.toMatchObject({ code: 'unauthenticated' });
    await service.activate(adminId, deviceId, true);
    await heartbeat();
    await service.report(input);
  });
  it('迟到补报、无匹配及不同金额保留核对，不自动给最新买家入账', async () => {
    const u = await user(),
      o = await order(u.id);
    const oldTime = new Date(clock.now().getTime() - 10 * 60_000).toISOString();
    const event = await receipt(o, { observedAt: oldTime, postedAt: oldTime });
    expect((await service.report(event)).status).toBe('review');
    expect((await service.get(u.id, o.id)).status).toBe('pending');
    const r = (await service.receipts({ limit: 100 })).items.find(
      (r) => r.eventId === (event.event as { eventId: string }).eventId,
    )!;
    expect(r.reason).toBe('delayed_or_clock');
    const resolved = await service.resolve(adminId, r.id, o.id, '合成账单与订单已核对');
    expect(resolved.status).toBe('matched');
    await service.resolve(adminId, r.id, o.id, '响应丢失安全重试');
    expect((await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(1);
    const wrong = await receipt(o, { amountFen: o.amountFen + 7 });
    await service.report(wrong);
    const unmatched = (await service.receipts({ limit: 100 })).items.find(
      (r) => r.eventId === (wrong.event as { eventId: string }).eventId,
    )!;
    expect(unmatched.status).toBe('review');
    await expect(
      service.resolve(adminId, unmatched.id, o.id, '金额不符必须拒绝'),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('取消与过期订单不自动履约', async () => {
    const u = await user(),
      o = await order(u.id);
    await service.get(u.id, o.id, true);
    expect((await service.report(await receipt(o))).status).toBe('review');
    const u2 = await user(),
      o2 = await order(u2.id);
    clock.advance(16 * 60_000);
    await heartbeat();
    expect((await service.report(await receipt(o2))).status).toBe('review');
    expect((await service.get(u2.id, o2.id)).status).toBe('expired');
    expect((await q.ledgerOf(u2.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(0);
  });
  it('会员按下单快照开通与赠送，续期接在到期日后，首次价只用一次', async () => {
    const u = await user();
    const first = await service.create(u.id, {
      clientOrderId: randomUUID(),
      channel: 'wechat',
      purchase: { kind: 'membership', planId: 'month' },
    });
    expect(first.baseFen).toBe(1290);
    const svc = app.get(MembershipOrderService),
      original = await svc.getSettings();
    await svc.updateSettings(adminId, {
      ...original,
      plans: original.plans.map((p) => ({ ...p, bonusPoints: 1 })),
    });
    await service.report(await receipt(first));
    await svc.updateSettings(adminId, original);
    expect(Number((await q.account(u.id))?.bonus_balance_micros)).toBe(3000 * 10000);
    const second = await service.create(u.id, {
      clientOrderId: randomUUID(),
      channel: 'alipay',
      purchase: { kind: 'membership', planId: 'quarter' },
    });
    expect(second.baseFen).toBe(5800);
    await service.report(await receipt(second));
    const rows = (await svc.listOrders({ userId: u.id, limit: 10 })).items;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.firstPurchase)).toHaveLength(1);
    const initial = rows.find((r) => r.firstPurchase)!,
      renewal = rows.find((r) => !r.firstPurchase)!;
    expect(renewal.startsAt).toBe(initial.endsAt);
    expect(renewal.bonusPoints).toBe(9000);
  });
  it('会员优惠被后台开通占用时不重复优惠，保留到账待核对', async () => {
    const u = await user(),
      o = await service.create(u.id, {
        clientOrderId: randomUUID(),
        channel: 'alipay',
        purchase: { kind: 'membership', planId: 'month' },
      });
    await app
      .get(MembershipOrderService)
      .createOrder(adminId, { clientOrderId: randomUUID(), userId: u.id, planId: 'month' });
    expect((await service.report(await receipt(o))).status).toBe('review');
    expect((await service.get(u.id, o.id)).status).toBe('review');
  });
  it('写流水失败整笔回滚，设备重试后只入账一次', async () => {
    const u = await user(),
      o = await order(u.id),
      event = await receipt(o);
    await withClient((c) =>
      c.query(
        `CREATE FUNCTION billing.scan_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.purpose='scan_recharge' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER scan_test_fail BEFORE INSERT ON billing.ledger_entries FOR EACH ROW EXECUTE FUNCTION billing.scan_test_fail()`,
      ),
    );
    try {
      await expect(service.report(event)).rejects.toMatchObject({
        cause: { message: 'synthetic failure' },
      });
    } finally {
      await withClient((c) =>
        c.query(
          'DROP TRIGGER scan_test_fail ON billing.ledger_entries; DROP FUNCTION billing.scan_test_fail()',
        ),
      );
    }
    expect((await service.get(u.id, o.id)).status).toBe('pending');
    expect((await service.report(event)).status).toBe('matched');
    expect((await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(1);
  });
  it('注销中的账号不入账；清除账号后保留无身份金额隔离记录', async () => {
    const u = await user(),
      o = await order(u.id),
      event = await receipt(o);
    await withClient((c) =>
      c.query("UPDATE identity.users SET status='deleting' WHERE id=$1", [u.id]),
    );
    expect((await service.report(event)).status).toBe('review');
    await app.get(BillingLifecycle).purgeUser(u.id);
    expect(await app.get(BillingLifecycle).countUserData(u.id)).toBe(0);
    const tombstone = (await service.list(null, { limit: 100 })).items.find((r) => r.id === o.id)!;
    expect(tombstone.userId).toBeNull();
    expect(tombstone.qr).toBe('');
    expect((await service.report(event)).status).toBe('review');
    expect(await q.account(u.id)).toBeNull();
  });
  it('心跳过期或监听断开不接受新订单，但已有真实到账保留供核对', async () => {
    const u = await user();
    clock.advance(3 * 60_000);
    expect((await service.options()).monitorOnline).toBe(false);
    await expect(order(u.id)).rejects.toMatchObject({ code: 'conflict' });
    await heartbeat();
    await service.report(await signed({ type: 'heartbeat', listenerConnected: false, queued: 0 }));
    await expect(order(u.id)).rejects.toMatchObject({ code: 'conflict' });
    await heartbeat();
  });
  it('重复事件改金额必须冲突；原账目保持不变', async () => {
    const u = await user(),
      o = await order(u.id),
      event = await receipt(o);
    await service.report(event);
    const sameEvent = event.event as Extract<ScanMonitorReport['event'], { type: 'receipt' }>;
    await expect(
      service.report(await signed({ ...sameEvent, amountFen: o.amountFen + 1 })),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(1);
  });
  it('旧接口固定关闭标志仍兼容旧客户端，新扫码渠道独立启用', async () => {
    const u = await user();
    expect(
      (
        await http()
          .get('/api/v1/me/membership/offer')
          .set('Authorization', `Bearer ${u.token}`)
          .expect(200)
      ).body.paymentEnabled,
    ).toBe(false);
    expect((await service.options()).enabled).toBe(true);
    await http()
      .get('/api/v1/admin/scan-payments/receipts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(capture.text).not.toContain('BEGIN PRIVATE KEY');
  });
  it('手机漏报可由管理员核实账单入账，重复编号与错误金额不能重复发权益', async () => {
    const u = await user(),
      o = await order(u.id);
    const input = {
      orderId: o.id,
      amountFen: o.amountFen,
      receiptReference: 'SYNTHETIC_BANK_123456',
      reason: '合成账单核对，非真实付款',
    };
    await http()
      .post('/api/v1/admin/scan-payments/manual-receipts')
      .set('Authorization', `Bearer ${u.token}`)
      .send(input)
      .expect(403);
    await expect(
      service.manualReceipt(adminId, { ...input, amountFen: o.amountFen + 1 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await service.manualReceipt(adminId, input)).status).toBe('matched');
    expect(
      (
        await service.manualReceipt(adminId, {
          ...input,
          receiptReference: input.receiptReference.toLowerCase(),
        })
      ).status,
    ).toBe('matched');
    expect((await q.ledgerOf(u.id)).filter((e) => e.purpose === 'scan_recharge')).toHaveLength(1);
    const other = await user(),
      otherOrder = await order(other.id);
    await expect(
      service.manualReceipt(adminId, {
        ...input,
        orderId: otherOrder.id,
        amountFen: otherOrder.amountFen,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const { rows } = await database.query<{ found: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM billing.scan_receipts WHERE event_id LIKE '%SYNTHETIC_BANK%') AS found",
    );
    expect(rows[0]!.found).toBe(false);
  });
});
