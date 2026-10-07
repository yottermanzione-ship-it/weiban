/**
 * billing 对外提供的注入令牌（从 index.ts 导出）。必须是 Symbol（engineering-standards 3.1 第 2 条）：
 * 不 import 就拿不到扣费端口。
 */

/** 契约 BillingReservationPort（冻结 / 结算 / 解冻）。**只有 model-access 可以注入**（R9）。 */
export const BILLING_RESERVATION_PORT = Symbol('weiban.billing.reservation-port');

/** 契约 BillingReadPort（getSpendStatus）：任何模块可读。 */
export const BILLING_READ_PORT = Symbol('weiban.billing.read-port');

/** 契约 BillingChargeQueryPort（v1.3，只读：查扣费、查价）：目前只有 model-access 使用。 */
export const BILLING_CHARGE_QUERY_PORT = Symbol('weiban.billing.charge-query-port');
