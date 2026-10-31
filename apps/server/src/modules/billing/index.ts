/**
 * billing 模块的公开出口（R1：其他模块只能 import 这里）。说明见 docs/backend/billing.md。
 *
 * - BillingModule：在 app.module.ts 装配。
 * - BILLING_RESERVATION_PORT：注入后得到契约 BillingReservationPort（冻结 / 结算 / 解冻）。
 *   **只有 model-access 的模型网关可以引用**（engineering-standards R9，lint 强制）。
 * - BILLING_READ_PORT：注入后得到契约 BillingReadPort（getSpendStatus），任何模块可用。
 */
export { BillingModule } from './billing.module.js';
export {
  BILLING_CHARGE_QUERY_PORT,
  BILLING_CUSTOMER_CONFIG_PORT,
  BILLING_DAILY_SPEND_READ_PORT,
  BILLING_MODEL_RATE_PORT,
  BILLING_PAID_HISTORY_PORT,
  BILLING_QUOTE_PORT,
  BILLING_READ_PORT,
  BILLING_RESERVATION_PORT,
  BILLING_SERVICE_FEE_PORT,
} from './tokens.js';
/** 本机运维脚本（cli/setup-local-model.ts）以管理员身份走服务层发布价目表、加余额。 */
export { PriceService } from './application/prices.js';
export { BillingAdminService } from './application/admin.js';
export { BILLING_SHARED_SEARCH_PORT } from './tokens.js';
