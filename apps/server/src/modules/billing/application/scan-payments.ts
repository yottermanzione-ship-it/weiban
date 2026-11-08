import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, lte, isNull, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';
import {
  ScanDevice,
  ScanOrder,
  ScanReceipt,
  ScanPaymentSettings,
  pointsToMicros,
  type ScanCreateOrder,
  type ScanMonitorReport,
  type IdentityAccountStatusPort,
  type IdentityMembershipWritePort,
  type ScanMonitorPair,
} from '@weiban/contracts';
import type { z } from 'zod';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import {
  IDENTITY_ACCOUNT_STATUS_PORT,
  IDENTITY_MEMBERSHIP_WRITE_PORT,
} from '../../identity/index.js';
import { billingSettings, membershipOrders } from '../infra/db/schema.js';
import {
  scanDevices,
  scanOrders,
  scanReceipts,
  type PurchaseSnapshot,
} from '../infra/db/scan-schema.js';
import { Ledger } from './ledger.js';
import { MembershipOrderService } from './membership-orders.js';

type OrderRow = typeof scanOrders.$inferSelect;
type ReceiptRow = typeof scanReceipts.$inferSelect;
type DeviceRow = typeof scanDevices.$inferSelect;
const SETTINGS_KEY = 'scan_payment';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const DEFAULTS: ScanPaymentSettings = {
  enabled: false,
  cutoverConfirmed: false,
  wechatQr: '',
  alipayQr: '',
};
const orderView = (r: OrderRow) =>
  ScanOrder.parse({
    ...r,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    qr: r.status === 'pending' ? r.qr : '',
  });
const receiptView = (r: ReceiptRow, purchase?: { kind: string; title: string } | null) =>
  ScanReceipt.parse({
    ...r,
    postedAt: r.postedAt.toISOString(),
    purchaseKind: purchase?.kind ?? null,
    purchaseTitle: purchase?.title ?? null,
    observedAt: r.observedAt.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
  });
const deviceView = (r: DeviceRow, now: Date) =>
  ScanDevice.parse({
    ...r,
    paired: !!r.publicKey,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    online:
      r.active &&
      r.listenerConnected &&
      !!r.lastSeenAt &&
      now.getTime() - r.lastSeenAt.getTime() < 2 * MINUTE,
  });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Versioned, fixed fields, ASCII delimiters. Android signs these exact UTF-8 bytes with SHA256withECDSA (DER). */
export function monitorSigningText(input: ScanMonitorReport): string {
  const e = input.event;
  const version = e.type === 'receipt' && e.reviewReason ? 'wb-pay-v2' : 'wb-pay-v1';
  const prefix = `${version}|${input.deviceId}|${input.requestTime}|${e.type}`;
  return e.type === 'heartbeat'
    ? `${prefix}|${e.listenerConnected ? 1 : 0}|${e.queued}`
    : `${prefix}|${e.eventId}|${e.channel}|${e.amountFen}|${e.observedAt}|${e.postedAt}${e.reviewReason ? `|${e.reviewReason}` : ''}`;
}
function validSignature(publicKey: string, message: string, signature: string): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return (
      key.asymmetricKeyType === 'ec' &&
      key.asymmetricKeyDetails?.namedCurve === 'prime256v1' &&
      verify('sha256', Buffer.from(message), key, Buffer.from(signature, 'base64'))
    );
  } catch {
    return false;
  }
}

@Injectable()
export class ScanPaymentService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(MembershipOrderService) private readonly membership: MembershipOrderService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly accounts: IdentityAccountStatusPort,
    @Inject(IDENTITY_MEMBERSHIP_WRITE_PORT)
    private readonly membershipWrite: IdentityMembershipWritePort,
  ) {}
  /** All scan mutations: short global lock → membership advisory → identity → wallet. Never network under this lock. */
  private async lock(tx: DbTx) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('billing:scan-payments',0))");
  }
  private async memberLock(tx: DbTx, userId: string) {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('billing:membership-order:' || $1,0))",
      [userId],
    );
  }
  private async activeUser(tx: DbTx, userId: string) {
    return (
      (await this.accounts.getAccountStatus(userId, tx)) === 'active' &&
      !(await this.accounts.isBanned?.(userId, tx))
    );
  }
  async settings(tx?: DbTx): Promise<ScanPaymentSettings> {
    const [r] = await (tx?.db ?? this.database.db)
      .select()
      .from(billingSettings)
      .where(eq(billingSettings.key, SETTINGS_KEY));
    return r ? ScanPaymentSettings.parse(r.value) : DEFAULTS;
  }
  async saveSettings(actor: string, input: ScanPaymentSettings) {
    for (const image of [input.wechatQr, input.alipayQr].filter(Boolean)) {
      try {
        const meta = await sharp(Buffer.from(image.split(',')[1]!, 'base64'), {
          limitInputPixels: 4_194_304,
        }).metadata();
        if (!['png', 'jpeg'].includes(meta.format ?? '') || !meta.width || !meta.height)
          throw new Error('format');
      } catch {
        throw new AppError('bad_request', '收款码必须是有效且不超过四百万像素的图片');
      }
    }
    if (input.enabled && (!input.cutoverConfirmed || !input.wechatQr || !input.alipayQr))
      throw new AppError(
        'bad_request',
        '请配置两个收款码，并确认旧站已停止独立认单或收款账户已隔离',
      );
    await this.database.transaction(async (tx) => {
      await this.lock(tx);
      const old = await this.settings(tx);
      // Pending orders retain their original QR; prohibit replacing accounts while payments are in flight.
      const [pending] = await tx.db
        .select({ id: scanOrders.id })
        .from(scanOrders)
        .where(and(eq(scanOrders.status, 'pending'), gt(scanOrders.expiresAt, this.clock.now())))
        .limit(1);
      if (pending && (old.wechatQr !== input.wechatQr || old.alipayQr !== input.alipayQr))
        throw new AppError('conflict', '还有待付款订单，请等待订单结束后再更换收款码');
      await tx.db
        .insert(billingSettings)
        .values({ key: SETTINGS_KEY, value: input, updatedAt: this.clock.now(), updatedBy: actor })
        .onConflictDoUpdate({
          target: billingSettings.key,
          set: { value: input, updatedAt: this.clock.now(), updatedBy: actor },
        });
      await this.record(tx, actor, 'scan.settings', null, {
        enabled: input.enabled,
        cutoverConfirmed: input.cutoverConfirmed,
        wechatConfigured: !!input.wechatQr,
        alipayConfigured: !!input.alipayQr,
      });
    });
    return input;
  }
  async options() {
    const settings = await this.settings();
    const [device] = await this.database.db
      .select()
      .from(scanDevices)
      .where(eq(scanDevices.active, true));
    const monitorOnline =
      !!device?.listenerConnected &&
      !!device.lastSeenAt &&
      device.lastSeenAt.getTime() > this.clock.now().getTime() - 2 * MINUTE;
    return {
      enabled: settings.enabled && settings.cutoverConfirmed,
      monitorOnline,
      channels: [
        ...(settings.wechatQr ? ['wechat' as const] : []),
        ...(settings.alipayQr ? ['alipay' as const] : []),
      ],
    };
  }
  private async expire(tx: DbTx) {
    await tx.db
      .update(scanOrders)
      .set({ status: 'expired' })
      .where(and(eq(scanOrders.status, 'pending'), lte(scanOrders.expiresAt, this.clock.now())));
  }
  async create(userId: string, input: ScanCreateOrder) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx);
      await this.expire(tx);
      const [existing] = await tx.db
        .select()
        .from(scanOrders)
        .where(eq(scanOrders.clientOrderId, input.clientOrderId));
      if (existing) {
        if (
          existing.userId !== userId ||
          existing.channel !== input.channel ||
          JSON.stringify(existing.purchase) !== JSON.stringify(input.purchase)
        )
          throw new AppError('conflict', '订单编号已用于另一笔购买');
        return orderView(existing);
      }
      await this.memberLock(tx, userId);
      if (!(await this.activeUser(tx, userId))) throw new AppError('not_found', '账号不可用');
      const settings = await this.settings(tx);
      const [device] = await tx.db.select().from(scanDevices).where(eq(scanDevices.active, true));
      if (!settings.enabled || !settings.cutoverConfirmed)
        throw new AppError('conflict', '扫码收款暂未开放');
      if (
        !device?.listenerConnected ||
        !device.lastSeenAt ||
        device.lastSeenAt.getTime() <= this.clock.now().getTime() - 2 * MINUTE
      )
        throw new AppError('conflict', '到账监控暂未连接，请稍后再试');
      const qr = input.channel === 'wechat' ? settings.wechatQr : settings.alipayQr;
      if (!qr) throw new AppError('conflict', '这个收款渠道暂未配置');
      const [pending] = await tx.db
        .select()
        .from(scanOrders)
        .where(and(eq(scanOrders.userId, userId), eq(scanOrders.status, 'pending')));
      if (pending) throw new AppError('conflict', '还有一笔待付款订单，请先查看或取消原订单');
      const recent = await tx.db
        .select({ id: scanOrders.id })
        .from(scanOrders)
        .where(
          and(
            eq(scanOrders.userId, userId),
            gt(scanOrders.createdAt, new Date(this.clock.now().getTime() - 15 * MINUTE)),
          ),
        )
        .limit(6);
      if (recent.length >= 5) throw new AppError('conflict', '创建订单过于频繁，请稍后重试');
      let baseFen: number;
      let title: string;
      const snapshot: PurchaseSnapshot = { plan: null, firstPurchase: false };
      if (input.purchase.kind === 'membership') {
        const plan = (await this.membership.getSettings(tx)).plans.find(
          (p) => input.purchase.kind === 'membership' && p.planId === input.purchase.planId,
        )!;
        const [first] = await tx.db
          .select({ id: membershipOrders.id })
          .from(membershipOrders)
          .where(
            and(eq(membershipOrders.userId, userId), eq(membershipOrders.firstPurchase, true)),
          );
        snapshot.plan = plan;
        snapshot.firstPurchase = !first;
        baseFen = first ? plan.priceFen : plan.firstPriceFen;
        title = `PRO+ ${plan.name}`;
      } else {
        baseFen = input.purchase.amountFen;
        title = '积分充值';
      }
      if (baseFen < 1) throw new AppError('conflict', '该档位无需扫码付款，请联系管理员开通');
      // Amounts are quarantined 24h, including cancelled/paid orders and unmatched receipts. Offline receipts never auto-match.
      const since = new Date(this.clock.now().getTime() - DAY);
      const used = await tx.db
        .select({ fen: scanOrders.amountFen })
        .from(scanOrders)
        .where(and(eq(scanOrders.channel, input.channel), gt(scanOrders.createdAt, since)));
      const seen = await tx.db
        .select({ fen: scanReceipts.amountFen })
        .from(scanReceipts)
        .where(and(eq(scanReceipts.channel, input.channel), gt(scanReceipts.receivedAt, since)));
      const amounts = new Set([...used, ...seen].map((r) => r.fen));
      // The selected recharge tier starts at ¥5; the actual discounted amount may be lower.
      // Otherwise the smallest tier could only serve one buyer per channel per day.
      const min = 1;
      let amountFen = baseFen;
      while (amounts.has(amountFen) && amountFen >= Math.max(min, baseFen - 99)) amountFen--;
      if (amountFen < Math.max(min, baseFen - 99))
        throw new AppError('conflict', '这个金额暂时没有可用付款位，请换金额、渠道或稍后再试');
      const now = this.clock.now();
      const [row] = await tx.db
        .insert(scanOrders)
        .values({
          id: newId(),
          clientOrderId: input.clientOrderId,
          userId,
          channel: input.channel,
          kind: input.purchase.kind,
          purchase: input.purchase,
          snapshot,
          title,
          baseFen,
          amountFen,
          points: snapshot.plan?.bonusPoints ?? amountFen,
          qr,
          status: 'pending',
          createdAt: now,
          expiresAt: new Date(now.getTime() + 15 * MINUTE),
        })
        .returning();
      return orderView(row!);
    });
  }
  async list(userId: string | null, query: { cursor?: string | undefined; limit: number }) {
    const offset = Number(query.cursor ?? 0);
    const rows = await this.database.db
      .select()
      .from(scanOrders)
      .where(userId ? eq(scanOrders.userId, userId) : undefined)
      .orderBy(desc(scanOrders.createdAt), desc(scanOrders.id))
      .offset(offset)
      .limit(query.limit + 1);
    return {
      items: rows
        .slice(0, query.limit)
        .map((r) =>
          orderView(
            r.status === 'pending' && r.expiresAt <= this.clock.now()
              ? { ...r, status: 'expired' }
              : r,
          ),
        ),
      nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
    };
  }
  async get(userId: string, id: string, cancel = false) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx);
      await this.expire(tx);
      const [row] = await tx.db
        .select()
        .from(scanOrders)
        .where(and(eq(scanOrders.id, id), eq(scanOrders.userId, userId)));
      if (!row) throw new AppError('not_found', '订单不存在');
      if (cancel && row.status === 'pending') {
        await tx.db.update(scanOrders).set({ status: 'cancelled' }).where(eq(scanOrders.id, id));
        row.status = 'cancelled';
      }
      return orderView(row);
    });
  }
  async devices() {
    return (
      await this.database.db.select().from(scanDevices).orderBy(desc(scanDevices.createdAt))
    ).map((r) => deviceView(r, this.clock.now()));
  }
  async pairCode(actor: string, name: string) {
    const pairCode = randomBytes(16).toString('hex'),
      expiresAt = new Date(this.clock.now().getTime() + 10 * MINUTE);
    const deviceId = await this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [pending] = await tx.db
        .select({ id: scanDevices.id })
        .from(scanDevices)
        .where(isNull(scanDevices.publicKey))
        .orderBy(desc(scanDevices.createdAt))
        .limit(1);
      const id = pending?.id ?? newId();
      if (pending)
        await tx.db
          .update(scanDevices)
          .set({ name, pairHash: digest(pairCode), pairExpiresAt: expiresAt })
          .where(eq(scanDevices.id, id));
      else
        await tx.db.insert(scanDevices).values({
          id,
          name,
          pairHash: digest(pairCode),
          pairExpiresAt: expiresAt,
          active: false,
          listenerConnected: false,
          queued: 0,
          createdAt: this.clock.now(),
        });
      await this.record(tx, actor, 'scan.device_created', id, { reusedPending: !!pending });
      return id;
    });
    return { deviceId, pairCode, expiresAt: expiresAt.toISOString() };
  }
  async pair(input: z.infer<typeof ScanMonitorPair>) {
    const message = `wb-pay-pair-v1|${input.deviceId}|${input.pairCode}|${input.publicKey}`;
    if (!validSignature(input.publicKey, message, input.signature))
      throw new AppError('unauthenticated', '设备签名无效');
    const active = await this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [row] = await tx.db
        .select()
        .from(scanDevices)
        .where(eq(scanDevices.id, input.deviceId));
      if (!row) throw new AppError('unauthenticated', '配对码无效或已过期');
      if (row.publicKey === input.publicKey) return row.active; // lost response: possession proof suffices for a paired key, never reactivates it
      if (
        row.publicKey ||
        row.pairHash !== digest(input.pairCode) ||
        row.pairExpiresAt < this.clock.now()
      )
        throw new AppError('unauthenticated', '配对码无效或已过期');
      const [paired] = await tx.db
        .select({ id: scanDevices.id })
        .from(scanDevices)
        .where(isNotNull(scanDevices.publicKey))
        .limit(1);
      const first = !paired;
      await tx.db
        .update(scanDevices)
        .set({ publicKey: input.publicKey, pairHash: null, active: first })
        .where(eq(scanDevices.id, row.id));
      await this.record(tx, null, 'scan.device_paired', row.id, { active: first });
      return first;
    });
    return { ok: true as const, active };
  }
  async activate(actor: string, id: string, active: boolean) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [old] = await tx.db.select().from(scanDevices).where(eq(scanDevices.id, id));
      if (!old?.publicKey) throw new AppError('bad_request', '请先完成设备配对');
      if (active)
        await tx.db.update(scanDevices).set({ active: false }).where(eq(scanDevices.active, true));
      const [row] = await tx.db
        .update(scanDevices)
        .set({ active })
        .where(eq(scanDevices.id, id))
        .returning();
      await this.record(tx, actor, 'scan.device_active', id, { active });
      return deviceView(row!, this.clock.now());
    });
  }
  async report(input: ScanMonitorReport) {
    const now = this.clock.now();
    if (Math.abs(now.getTime() - Date.parse(input.requestTime)) > 5 * MINUTE)
      throw new AppError('unauthenticated', '设备时间不正确');
    const [device] = await this.database.db
      .select()
      .from(scanDevices)
      .where(eq(scanDevices.id, input.deviceId));
    if (
      !device?.active ||
      !device.publicKey ||
      !validSignature(device.publicKey, monitorSigningText(input), input.signature)
    )
      throw new AppError('unauthenticated', '监控设备未启用或签名无效');
    const outcome = await this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [current] = await tx.db
        .select()
        .from(scanDevices)
        .where(eq(scanDevices.id, input.deviceId));
      if (!current?.active || current.publicKey !== device.publicKey)
        throw new AppError('unauthenticated', '监控设备已停用');
      const e = input.event;
      if (e.type === 'heartbeat') {
        await tx.db
          .update(scanDevices)
          .set({ lastSeenAt: now, listenerConnected: e.listenerConnected, queued: e.queued })
          .where(eq(scanDevices.id, current.id));
        return { ok: true as const, status: 'online' };
      }
      const [existing] = await tx.db
        .select()
        .from(scanReceipts)
        .where(and(eq(scanReceipts.deviceId, current.id), eq(scanReceipts.eventId, e.eventId)));
      if (existing) {
        if (
          existing.channel !== e.channel ||
          existing.amountFen !== e.amountFen ||
          existing.observedAt.getTime() !== Date.parse(e.observedAt) ||
          existing.postedAt.getTime() !== Date.parse(e.postedAt)
        ) {
          await this.record(tx, null, 'scan.receipt_conflict', existing.id, {
            deviceId: current.id,
          });
          return { ok: true as const, status: 'event_conflict' };
        }
        return this.reportResult(tx, existing);
      }
      const observed = new Date(e.observedAt),
        posted = new Date(e.postedAt);
      let reason = 'no_order';
      const lag = now.getTime() - observed.getTime();
      if (
        lag < -5_000 ||
        lag > 2 * MINUTE ||
        Math.abs(observed.getTime() - posted.getTime()) > 2 * MINUTE
      )
        reason = 'delayed_or_clock';
      else if (
        !current.listenerConnected ||
        !current.lastSeenAt ||
        current.lastSeenAt.getTime() < now.getTime() - 2 * MINUTE
      )
        reason = 'monitor_offline';
      const settings = await this.settings(tx);
      if (!settings.enabled || !settings.cutoverConfirmed) reason = 'payments_disabled';
      // Keep uncertain money-bearing notices visible even when an equal-price order exists.
      if (e.reviewReason) reason = e.reviewReason;
      const [receipt] = await tx.db
        .insert(scanReceipts)
        .values({
          id: newId(),
          deviceId: current.id,
          eventId: e.eventId,
          channel: e.channel,
          amountFen: e.amountFen,
          observedAt: observed,
          postedAt: posted,
          receivedAt: now,
          status: 'review',
          reason,
          orderId: null,
        })
        .returning();
      if (reason === 'no_order') {
        // Both notification timestamps must fit. Do not assign late money to the next buyer of the same amount.
        const candidates = await tx.db
          .select()
          .from(scanOrders)
          .where(
            and(
              eq(scanOrders.channel, e.channel),
              eq(scanOrders.amountFen, e.amountFen),
              eq(scanOrders.status, 'pending'),
              lte(scanOrders.createdAt, posted),
              gt(scanOrders.expiresAt, observed),
              gt(scanOrders.expiresAt, now),
            ),
          )
          .limit(2);
        if (candidates.length === 1) await this.fulfill(tx, candidates[0]!, receipt!, null);
        else if (candidates.length > 1)
          await tx.db
            .update(scanReceipts)
            .set({ reason: 'ambiguous' })
            .where(eq(scanReceipts.id, receipt!.id));
      }
      const [saved] = await tx.db
        .select()
        .from(scanReceipts)
        .where(eq(scanReceipts.id, receipt!.id));
      return this.reportResult(tx, saved!);
    });
    if (outcome.status === 'event_conflict')
      throw new AppError('conflict', '到账标识与原记录冲突，请人工核对');
    return outcome;
  }
  private async receiptDetails(tx: DbTx, receipt: ReceiptRow) {
    const [purchase] = receipt.orderId
      ? await tx.db
          .select({ kind: scanOrders.kind, title: scanOrders.title })
          .from(scanOrders)
          .where(eq(scanOrders.id, receipt.orderId))
      : [];
    return receiptView(receipt, purchase);
  }
  private async reportResult(tx: DbTx, receipt: ReceiptRow) {
    const result = await this.receiptDetails(tx, receipt);
    return { ok: true as const, status: receipt.status, purchaseKind: result.purchaseKind ?? null };
  }
  private async fulfill(tx: DbTx, order: OrderRow, receipt: ReceiptRow, actor: string | null) {
    if (!order.userId) return this.review(tx, order, receipt, 'account_unavailable');
    if (order.status === 'paid' || receipt.status !== 'review')
      throw new AppError('conflict', '这笔订单或到账已处理');
    if (order.amountFen !== receipt.amountFen || order.channel !== receipt.channel)
      throw new AppError('conflict', '金额或收款渠道不同，不能关联');
    await this.memberLock(tx, order.userId);
    // Paid membership takes the identity write lock before any wallet lock. Do not upgrade a SHARE lock held by concurrent grants.
    if (
      (await this.accounts.getAccountStatus(order.userId, tx)) !== 'active' ||
      (await this.accounts.isBanned?.(order.userId, tx))
    )
      return this.review(tx, order, receipt, 'account_unavailable');
    const { plan, firstPurchase } = order.snapshot;
    if (plan && firstPurchase) {
      const [first] = await tx.db
        .select({ id: membershipOrders.id })
        .from(membershipOrders)
        .where(
          and(eq(membershipOrders.userId, order.userId), eq(membershipOrders.firstPurchase, true)),
        );
      if (first) return this.review(tx, order, receipt, 'first_price_already_used');
    }
    const period = plan
      ? await this.membershipWrite.extendProPlus(
          { userId: order.userId, months: plan.months, operatorUserId: actor },
          tx,
        )
      : null;
    const wallet = await this.ledger.lockUserAccount(tx, order.userId);
    let ledgerEntryId: string | null = null;
    if (order.points > 0) {
      const { entry } = await this.ledger.postEntry(tx, wallet, {
        type: 'admin_grant',
        amountMicros: pointsToMicros(order.points),
        idempotencyKey: `scan_payment:${order.id}`,
        purpose: plan ? 'membership_bonus' : 'scan_recharge',
        reason: plan ? `开通 ${order.title}赠送` : '扫码充值',
        operatorUserId: actor,
        bonusCredit: !!plan,
      });
      ledgerEntryId = entry.id;
    }
    const membershipOrderId = plan ? newId() : null;
    if (plan && period)
      await tx.db.insert(membershipOrders).values({
        id: membershipOrderId!,
        clientOrderId: order.id,
        userId: order.userId,
        planId: plan.planId,
        priceFen: order.amountFen,
        listPriceFen: plan.priceFen,
        firstPurchase,
        bonusPoints: plan.bonusPoints,
        startsAt: new Date(period.startsAt),
        endsAt: new Date(period.endsAt),
        ledgerEntryId,
        operatorUserId: actor,
        note: '扫码付款开通',
        createdAt: this.clock.now(),
      });
    await tx.db
      .update(scanOrders)
      .set({ status: 'paid', paidAt: this.clock.now(), ledgerEntryId, membershipOrderId })
      .where(eq(scanOrders.id, order.id));
    await tx.db
      .update(scanReceipts)
      .set({ status: 'matched', reason: actor ? 'manual' : 'automatic', orderId: order.id })
      .where(eq(scanReceipts.id, receipt.id));
    await this.record(tx, actor, 'scan.paid', order.id, {
      receiptId: receipt.id,
      amountFen: order.amountFen,
      kind: order.kind,
    });
  }
  private async review(tx: DbTx, order: OrderRow, receipt: ReceiptRow, reason: string) {
    await tx.db.update(scanOrders).set({ status: 'review' }).where(eq(scanOrders.id, order.id));
    await tx.db.update(scanReceipts).set({ reason }).where(eq(scanReceipts.id, receipt.id));
  }
  async receipts(query: { cursor?: string | undefined; limit: number }) {
    const offset = Number(query.cursor ?? 0);
    const rows = await this.database.db
      .select({ receipt: scanReceipts, kind: scanOrders.kind, title: scanOrders.title })
      .from(scanReceipts)
      .leftJoin(scanOrders, eq(scanReceipts.orderId, scanOrders.id))
      .orderBy(desc(scanReceipts.receivedAt), desc(scanReceipts.id))
      .offset(offset)
      .limit(query.limit + 1);
    return {
      items: rows
        .slice(0, query.limit)
        .map((r) =>
          receiptView(r.receipt, r.kind && r.title ? { kind: r.kind, title: r.title } : null),
        ),
      nextCursor: rows.length > query.limit ? String(offset + query.limit) : null,
    };
  }
  async resolve(actor: string, id: string, orderId: string | null, reason: string) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [receipt] = await tx.db.select().from(scanReceipts).where(eq(scanReceipts.id, id));
      if (!receipt) throw new AppError('not_found', '到账记录不存在');
      if (receipt.status !== 'review') {
        if ((orderId && receipt.orderId === orderId) || (!orderId && receipt.status === 'ignored'))
          return this.receiptDetails(tx, receipt);
        throw new AppError('conflict', '这条到账已处理');
      }
      if (!orderId)
        await tx.db
          .update(scanReceipts)
          .set({ status: 'ignored', reason: 'manual_ignored' })
          .where(eq(scanReceipts.id, id));
      else {
        const [order] = await tx.db.select().from(scanOrders).where(eq(scanOrders.id, orderId));
        if (!order) throw new AppError('not_found', '订单不存在');
        await this.fulfill(tx, order, receipt, actor);
      }
      await this.record(tx, actor, 'scan.receipt_resolved', id, { orderId, reason });
      const [saved] = await tx.db.select().from(scanReceipts).where(eq(scanReceipts.id, id));
      return this.receiptDetails(tx, saved!);
    });
  }
  async manualReceipt(
    actor: string,
    input: { orderId: string; amountFen: number; receiptReference: string; reason: string },
  ) {
    return this.database.transaction(async (tx) => {
      await this.lock(tx);
      const [order] = await tx.db.select().from(scanOrders).where(eq(scanOrders.id, input.orderId));
      if (!order) throw new AppError('not_found', '订单不存在');
      if (order.amountFen !== input.amountFen)
        throw new AppError('conflict', '实际收款金额与订单不一致，不能入账');
      // Bank reference is never retained verbatim. It must still identify only one settlement across retries/operators.
      const eventId =
        'manual:' + digest(order.channel + '|' + input.receiptReference.trim().toUpperCase());
      const [old] = await tx.db
        .select()
        .from(scanReceipts)
        .where(
          and(
            isNull(scanReceipts.deviceId),
            eq(scanReceipts.channel, order.channel),
            eq(scanReceipts.eventId, eventId),
          ),
        );
      if (old) {
        if (old.orderId !== order.id)
          throw new AppError('conflict', '该收款交易编号已登记，请从到账列表核对原记录');
        return this.receiptDetails(tx, old);
      }
      if (order.status === 'paid') throw new AppError('conflict', '订单已入账，不可重复登记');
      const now = this.clock.now();
      const [receipt] = await tx.db
        .insert(scanReceipts)
        .values({
          id: newId(),
          deviceId: null,
          eventId,
          channel: order.channel,
          amountFen: input.amountFen,
          observedAt: now,
          postedAt: now,
          receivedAt: now,
          status: 'review',
          reason: 'manual_registered',
          orderId: null,
        })
        .returning();
      await this.fulfill(tx, order, receipt!, actor);
      await this.record(tx, actor, 'scan.receipt_manual', receipt!.id, {
        orderId: order.id,
        amountFen: input.amountFen,
        reason: input.reason,
      });
      const [saved] = await tx.db
        .select()
        .from(scanReceipts)
        .where(eq(scanReceipts.id, receipt!.id));
      return this.receiptDetails(tx, saved!);
    });
  }
  private async record(
    tx: DbTx,
    actor: string | null,
    action: string,
    id: string | null,
    details: Record<string, unknown>,
  ) {
    await this.audit.record(
      {
        module: 'billing',
        action,
        actorType: actor ? 'admin' : 'system',
        actorId: actor,
        targetType: 'scan_payment',
        targetId: id,
        details,
      },
      tx,
    );
  }
}
