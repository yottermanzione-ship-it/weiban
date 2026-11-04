/** 独立验收：仅合成数据，真实服务与数据库；不修改被审业务代码。 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { AppModule } from '../../../../apps/server/src/app.module.js';
import { IdentityCommands } from '../../../../apps/server/src/modules/identity/index.js';
import { MembershipService } from '../../../../apps/server/src/modules/identity/application/membership.js';
import { MembershipOrderService } from '../../../../apps/server/src/modules/billing/application/membership-orders.js';
import { BillingAdminService, BillingTestQueries, PriceService, ReservationService, ReconciliationService } from '../../../../apps/server/src/modules/billing/testing.js';
import { ServiceFeeService } from '../../../../apps/server/src/modules/billing/application/service-fees.js';
import { RoleRequestService } from '../../../../apps/server/src/modules/plaza/application/role-requests.service.js';
import { DATABASE, TestClock, newId, type Database } from '../../../../apps/server/src/platform/index.js';
import { resetTestDatabase } from '../../../../apps/server/test/support/db.js';
import { captureLogger, testConfig, testKekRing } from '../../../../apps/server/test/support/fixtures.js';

let app: any, db: Database, commands: IdentityCommands, orders: MembershipOrderService;
let fees: ServiceFeeService, roles: RoleRequestService, membership: MembershipService;
let admin: string, q: BillingTestQueries, sequence = 0;
const clock = new TestClock('2026-11-04T08:00:00.000Z');
beforeAll(async () => {
  if (new URL(process.env.TEST_DATABASE_URL ?? '').pathname !== '/wbqa_test_20261104')
    throw new Error('QA probe requires its own named database');
  await resetTestDatabase();
  const fixture = await Test.createTestingModule({ imports: [AppModule.forRoot({
    config: testConfig(), clock, logger: captureLogger().logger,
    kekRing: testKekRing().ring, background: false,
  })] }).compile();
  app = fixture.createNestApplication({ logger: false });
  await app.init();
  db = app.get(DATABASE); commands = app.get(IdentityCommands);
  orders = app.get(MembershipOrderService); fees = app.get(ServiceFeeService);
  roles = app.get(RoleRequestService); membership = app.get(MembershipService);
  q = new BillingTestQueries(db);
  admin = await commands.createAdmin('qa_billing_admin', randomBytes(24).toString('hex'));
  await roles.updateConfig(admin, { enabled: true, pointsCost: 200, maxOpenPerUser: 10,
    lifetimeFreeCount: 0, proPlusWeeklyFreeCount: 0 });
});
afterAll(async () => { vi.restoreAllMocks(); await app?.close(); });
async function user(points = 1000) {
  const name = `qa_billing_${++sequence}`;
  const id = await commands.createAdmin(name, randomBytes(24).toString('hex'));
  await commands.setRole(name, 'user');
  await app.get(BillingAdminService).adjust(admin, id, {
    direction: 'grant', points, reason: '合成验收账户', idempotencyKey: newId(),
  });
  return id;
}
function order(userId: string, clientOrderId = newId(), planId = 'month' as const) {
  return orders.createOrder(admin, { userId, clientOrderId, planId, useFirstPrice: true });
}
function request(userId: string) {
  return roles.create(userId, { clientRequestId: newId(), roleName: '合成成年原创角色', expectedPointsCost: 200 });
}
function signal() {
  let resolve!: () => void;
  return { promise: new Promise<void>((r) => { resolve = r; }), release: () => resolve() };
}
function errorCode(error: any): string {
  return error?.code ?? (error?.cause ? errorCode(error.cause) : error?.name ?? 'unknown');
}

it('同一会员订单并发重试只赠送一次、只延长一次；不同订单首次价只享受一次', async () => {
  const id = await user(), key = newId();
  const [a, b] = await Promise.all([order(id, key), order(id, key)]);
  expect(a.order.orderId).toBe(b.order.orderId);
  expect(a.order.endsAt).toBe('2026-12-04T08:00:00.000Z');
  expect(Number((await q.account(id))?.balance_micros)).toBe(40_000_000);
  expect(Number((await q.account(id))?.bonus_balance_micros)).toBe(30_000_000);
  const id2 = await user();
  const distinct = await Promise.all([order(id2), order(id2)]);
  expect(distinct.filter((r) => r.order.firstPurchase)).toHaveLength(1);
  expect((await membership.getMembership(id2)).expiresAt).toBe('2027-01-04T08:00:00.000Z');
  expect(Number((await q.account(id2))?.balance_micros)).toBe(70_000_000);
});

it('付费制作申请撤回全额解冻，重复撤回不返两次；已结算服务优先扣赠送积分', async () => {
  const id = await user();
  await order(id);
  const created = await request(id);
  expect(Number((await q.account(id))?.held_micros)).toBe(2_000_000);
  await roles.cancel(id, created.requestId);
  await roles.cancel(id, created.requestId);
  expect(Number((await q.account(id))?.held_micros)).toBe(0);
  expect(Number((await q.account(id))?.balance_micros)).toBe(40_000_000);
  const held = await fees.hold({ userId: id, kind: 'role_request', amountMicros: 2_000_000,
    idempotencyKey: newId(), note: '合成服务费用' });
  if (!held.ok) throw new Error('Synthetic fee hold rejected');
  await Promise.all([fees.settle(held.value.holdId), fees.settle(held.value.holdId)]);
  const account = await q.account(id);
  expect(Number(account?.balance_micros)).toBe(38_000_000);
  expect(Number(account?.bonus_balance_micros)).toBe(28_000_000);
  expect(Number(account?.held_micros)).toBe(0);
});

it('会员开通与付费制作申请同时执行应均成功（MEM-R01 真实数据库复现）', async () => {
  const id = await user();
  const reachedFees = signal(), reachedMember = signal();
  const originalHold = fees.hold.bind(fees), originalExtend = membership.extendProPlus.bind(membership);
  // 只控制调用时序：锁、事务、扣费、角色服务均执行原实现。
  const feeSpy = vi.spyOn(fees, 'hold').mockImplementationOnce(async (...args) => {
    reachedFees.release(); await reachedMember.promise; return originalHold(...args);
  });
  const memberSpy = vi.spyOn(membership, 'extendProPlus').mockImplementationOnce(async (...args) => {
    reachedMember.release(); return originalExtend(...args);
  });
  let outcomes: PromiseSettledResult<unknown>[] = [];
  try {
    const role = request(id);
    await reachedFees.promise;
    outcomes = await Promise.allSettled([role, order(id)]);
  } finally { feeSpy.mockRestore(); memberSpy.mockRestore(); reachedMember.release(); }
  const account = await q.account(id);
  const atomicity = await db.query<{ orders: string; memberships: string; requests: string }>(
    `SELECT (SELECT count(*) FROM billing.membership_orders WHERE user_id=$1) AS orders,
      (SELECT count(*) FROM identity.memberships WHERE user_id=$1) AS memberships,
      (SELECT count(*) FROM plaza.role_requests WHERE user_id=$1) AS requests`, [id]);
  console.log(JSON.stringify({ probe: 'MEM-R01', outcomes: outcomes.map((r) =>
    r.status === 'fulfilled' ? { status: r.status } : { status: r.status, code: errorCode(r.reason) }),
    balanceMicros: Number(account?.balance_micros), heldMicros: Number(account?.held_micros),
    atomicity: atomicity.rows[0] }));
  expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
});

it('获准先用后扣产生的欠费不应被标为账本不一致', async () => {
  const id = await user(1), modelKey = 'qa/reconciliation';
  const prices = app.get(PriceService), reservations = app.get(ReservationService);
  const draft = await prices.createDraft(admin, { versionLabel: 'qa-reconciliation', note: null,
    items: [{ modelKey, unit: 'input_tokens_per_million', priceMicros: 1_300_000,
      costMicros: 1_000_000, band: null }] });
  await prices.activate(admin, draft.priceVersionId, null);
  const reserved = await reservations.estimateAndReserve({ account: { kind: 'user', userId: id },
    purpose: 'chat_reply', modelKey, estimate: { inputTokens: 1000 },
    ceiling: { usage: { inputTokens: 10_000 }, evidence: 'QA approved postpaid', pricingModels: [modelKey] },
    idempotencyKey: newId() });
  if (!reserved.ok) throw new Error('Synthetic reservation rejected');
  const charged = await reservations.settle({ holdId: reserved.value.holdId, usageRecordId: newId(),
    actual: { inputTokens: 10_000 }, startedAt: clock.now().toISOString() });
  expect(charged.balanceAfterMicros).toBe(-3000);
  const result = await app.get(ReconciliationService).run('2026-11-04');
  const stored = await db.query<{ balance: number; held: number; debt: number }>(
    `SELECT jsonb_array_length(details->'balanceMismatches') AS balance,
       jsonb_array_length(details->'heldMismatches') AS held,
       jsonb_array_length(details->'overdrawnAccounts') AS debt
     FROM billing.reconciliation_runs WHERE run_date=$1`, ['2026-11-04']);
  const detail = stored.rows[0]!;
  console.log(JSON.stringify({ probe: 'postpaid-reconciliation', ledgerConsistent: result.ledgerConsistent,
    balanceMismatchCount: detail.balance, heldMismatchCount: detail.held,
    overdrawnCount: detail.debt }));
  expect(detail.balance).toBe(0);
  expect(detail.held).toBe(0);
  expect(result.ledgerConsistent).toBe(true);
});
