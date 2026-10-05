/**
 * billing 模块的公开出口（R1：其他模块只能 import 这里）。说明见 docs/backend/billing.md。
 *
 * - BillingModule：在 app.module.ts 装配。
 * - BILLING_RESERVATION_PORT：注入后得到契约 BillingReservationPort（冻结 / 结算 / 解冻）。
 *   **只有 model-access 的模型网关可以引用**（engineering-standards R9，lint 强制）。
 * - BILLING_READ_PORT：注入后得到契约 BillingReadPort（getSpendStatus），任何模块可用。
 */
export { BillingModule } from './billing.module.js';
export { BILLING_READ_PORT, BILLING_RESERVATION_PORT } from './tokens.js';
