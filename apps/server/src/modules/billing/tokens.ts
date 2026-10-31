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

/** 契约 3.1 BillingQuotePort（按价目表报价，不冻结）。只给 model-access 注入（与 R9 同理）。 */
export const BILLING_QUOTE_PORT = Symbol('weiban.billing.quote-port');

/** 契约 3.1 BillingDailySpendReadPort（用户当地某天按用途的已结算金额）：任何模块可读。 */
export const BILLING_DAILY_SPEND_READ_PORT = Symbol('weiban.billing.daily-spend-read-port');

/** 契约 3.3 BillingModelRatePort（模型倍率：读 / 发布 token 价格）。只给 model-access 注入。 */
export const BILLING_MODEL_RATE_PORT = Symbol('weiban.billing.model-rate-port');

/** 契约 3.25 BillingPaidHistoryPort（是否付过费：充值过或开通过会员）。调用方：growth 好感度权益卡死。 */
export const BILLING_PAID_HISTORY_PORT = Symbol('weiban.billing.paid-history-port');

/** 契约 3.8 BillingServiceFeePort（固定金额服务费：冻结 / 扣除 / 退回）。调用方：plaza 申请制作。 */
export const BILLING_SERVICE_FEE_PORT = Symbol('weiban.billing.service-fee-port');

/** 契约 BillingCustomerConfigReadPort（会员/充值配置只读）。调用方：小V同学客服简报。 */
export const BILLING_CUSTOMER_CONFIG_PORT = Symbol('weiban.billing.customer-config-port');
export const BILLING_SHARED_SEARCH_PORT = Symbol('weiban.billing.shared-search');
