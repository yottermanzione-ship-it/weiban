/** 扫码付款：服务端报价、设备签名到账、人工对账。旧版 paymentEnabled 保持原义，避免旧客户端解析失败。 */
import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, cursorPage, defineEndpoint } from '../common.js';
import { MembershipPlanId } from './membership.js';

export const ScanChannel = z.enum(['wechat', 'alipay']);
export type ScanChannel = z.infer<typeof ScanChannel>;
const QrImage = z
  .string()
  .max(400_000)
  .regex(/^(?:|data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+)$/);
export const ScanPaymentSettings = z
  .object({
    enabled: z.boolean(),
    /** 管理员确认旧站不再独立认领同一收款码到账，或使用隔离的收款账户。 */
    cutoverConfirmed: z.boolean(),
    wechatQr: QrImage,
    alipayQr: QrImage,
  })
  .strict();
export type ScanPaymentSettings = z.infer<typeof ScanPaymentSettings>;
export const ScanPurchase = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('recharge'), amountFen: z.number().int().min(500).max(1_000_000) })
    .strict(),
  z.object({ kind: z.literal('membership'), planId: MembershipPlanId }).strict(),
]);
export type ScanPurchase = z.infer<typeof ScanPurchase>;
export const ScanOrder = z.object({
  id: Id,
  userId: Id.nullable(),
  channel: ScanChannel,
  title: z.string(),
  kind: z.enum(['recharge', 'membership']),
  amountFen: z.number().int().positive(),
  baseFen: z.number().int().positive(),
  points: z.number().int().nonnegative(),
  status: z.enum(['pending', 'paid', 'cancelled', 'expired', 'review']),
  createdAt: Timestamp,
  expiresAt: Timestamp,
  paidAt: Timestamp.nullable(),
  qr: z.string(),
});
export type ScanOrder = z.infer<typeof ScanOrder>;
export const ScanReceipt = z.object({
  id: Id,
  deviceId: Id.nullable(),
  eventId: z.string(),
  channel: ScanChannel,
  amountFen: z.number().int().positive(),
  observedAt: Timestamp,
  receivedAt: Timestamp,
  postedAt: Timestamp.optional(),
  purchaseKind: z.enum(['recharge', 'membership']).nullable().optional(),
  purchaseTitle: z.string().nullable().optional(),
  status: z.enum(['review', 'matched', 'ignored']),
  reason: z.string(),
  orderId: Id.nullable(),
});
export type ScanReceipt = z.infer<typeof ScanReceipt>;
export const ScanDevice = z.object({
  id: Id,
  name: z.string(),
  paired: z.boolean(),
  active: z.boolean(),
  lastSeenAt: Timestamp.nullable(),
  listenerConnected: z.boolean(),
  queued: z.number().int(),
  online: z.boolean(),
});
export type ScanDevice = z.infer<typeof ScanDevice>;
export const ScanCreateOrder = z
  .object({ clientOrderId: Id, channel: ScanChannel, purchase: ScanPurchase })
  .strict();
export type ScanCreateOrder = z.infer<typeof ScanCreateOrder>;
const PageQuery = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,7}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const OrderParams = z.object({ orderId: Id });
const root = API_PREFIX + '/billing/scan';
export const ScanPaymentEndpoints = {
  options: defineEndpoint({
    method: 'GET',
    path: root + '/options',
    auth: 'user',
    response: z.object({
      enabled: z.boolean(),
      monitorOnline: z.boolean(),
      channels: z.array(ScanChannel),
    }),
    summary: '扫码支付可用渠道与到账监控连接状态',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: root + '/orders',
    auth: 'user',
    body: ScanCreateOrder,
    response: ScanOrder,
    summary: '按服务端快照创建积分或会员扫码单',
  }),
  list: defineEndpoint({
    method: 'GET',
    path: root + '/orders',
    auth: 'user',
    query: PageQuery,
    response: cursorPage(ScanOrder),
    summary: '本人扫码订单及处理状态',
  }),
  get: defineEndpoint({
    method: 'GET',
    path: root + '/orders/:orderId',
    auth: 'user',
    params: OrderParams,
    response: ScanOrder,
    summary: '查询本人到账；客户端不能确认付款',
  }),
  cancel: defineEndpoint({
    method: 'POST',
    path: root + '/orders/:orderId/cancel',
    auth: 'user',
    params: OrderParams,
    response: ScanOrder,
    summary: '取消未付款订单；已付款订单不能撤销入账',
  }),
} as const;
const admin = API_PREFIX + '/admin/scan-payments';
export const ScanPaymentAdminEndpoints = {
  manualReceipt: defineEndpoint({
    method: 'POST',
    path: admin + '/manual-receipts',
    auth: 'admin',
    body: z
      .object({
        orderId: Id,
        amountFen: z.number().int().positive(),
        receiptReference: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{8,100}$/),
        reason: z.string().trim().min(5).max(200),
      })
      .strict(),
    response: ScanReceipt,
    summary: '管理员核实真实账单后登记漏报；按支付机构交易编号摘要去重，不退款',
  }),
  settings: defineEndpoint({
    method: 'GET',
    path: admin + '/settings',
    auth: 'admin',
    response: ScanPaymentSettings,
    summary: '收款码及支付开关',
  }),
  saveSettings: defineEndpoint({
    method: 'PUT',
    path: admin + '/settings',
    auth: 'admin',
    body: ScanPaymentSettings,
    response: ScanPaymentSettings,
    summary: '保存收款码和旧站切换确认',
  }),
  orders: defineEndpoint({
    method: 'GET',
    path: admin + '/orders',
    auth: 'admin',
    query: PageQuery,
    response: cursorPage(ScanOrder),
    summary: '扫码订单对账列表',
  }),
  receipts: defineEndpoint({
    method: 'GET',
    path: admin + '/receipts',
    auth: 'admin',
    query: PageQuery,
    response: cursorPage(ScanReceipt),
    summary: '签名到账记录及待核对原因，不返回通知原文',
  }),
  resolve: defineEndpoint({
    method: 'POST',
    path: admin + '/receipts/:receiptId/resolve',
    auth: 'admin',
    params: z.object({ receiptId: Id }),
    body: z.object({ orderId: Id.nullable(), reason: z.string().trim().min(5).max(200) }).strict(),
    response: ScanReceipt,
    summary: '人工核实后关联等额订单或标记忽略；不退款',
  }),
  devices: defineEndpoint({
    method: 'GET',
    path: admin + '/devices',
    auth: 'admin',
    response: z.array(ScanDevice),
    summary: '收款监控配对与连接状态',
  }),
  pairCode: defineEndpoint({
    method: 'POST',
    path: admin + '/devices',
    auth: 'admin',
    body: z.object({ name: z.string().trim().min(1).max(40) }).strict(),
    response: z.object({ deviceId: Id, pairCode: z.string(), expiresAt: Timestamp }),
    summary: '生成十分钟一次性监控配对码；服务端仅保存摘要',
  }),
  activate: defineEndpoint({
    method: 'PUT',
    path: admin + '/devices/:deviceId',
    auth: 'admin',
    params: z.object({ deviceId: Id }),
    body: z.object({ active: z.boolean() }).strict(),
    response: ScanDevice,
    summary: '启用唯一到账监控或停用设备',
  }),
} as const;
export const ScanMonitorPair = z
  .object({
    deviceId: Id,
    pairCode: z.string().regex(/^[a-f0-9]{32}$/),
    publicKey: z.string().max(300),
    signature: z.string().max(200),
  })
  .strict();
export const ScanMonitorReport = z
  .object({
    deviceId: Id,
    requestTime: Timestamp,
    signature: z.string().max(200),
    event: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('heartbeat'),
          listenerConnected: z.boolean(),
          queued: z.number().int().min(0).max(1_000_000),
        })
        .strict(),
      z
        .object({
          type: z.literal('receipt'),
          eventId: z.string().regex(/^[a-f0-9]{64}$/),
          channel: ScanChannel,
          amountFen: z.number().int().min(1).max(10_000_000),
          observedAt: Timestamp,
          postedAt: Timestamp,
        })
        .strict(),
    ]),
  })
  .strict();
export type ScanMonitorReport = z.infer<typeof ScanMonitorReport>;
export const ScanMonitorEndpoints = {
  pair: defineEndpoint({
    method: 'POST',
    path: root + '/monitor/pair',
    auth: 'none',
    body: ScanMonitorPair,
    response: z.object({ ok: z.literal(true), active: z.boolean().optional() }),
    summary: '用一次性配对码登记设备公钥，验证持有私钥',
  }),
  report: defineEndpoint({
    method: 'POST',
    path: root + '/monitor/report',
    auth: 'none',
    body: ScanMonitorReport,
    response: z.object({
      ok: z.literal(true),
      status: z.string(),
      purchaseKind: z.enum(['recharge', 'membership']).nullable().optional(),
    }),
    summary: '验证设备签名后持久保存到账；只确认已提交结果',
  }),
} as const;
