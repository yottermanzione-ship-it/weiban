/**
 * billing 的测试出口（R10：只给测试用，生产代码 import 会被 lint 拦截）。
 * 集成测试断言 billing 表的状态、手动触发定时任务（过期清理、对账）时用这里，不直接引用模块内部文件。
 */
import type { Database } from '../../platform/index.js';

export { ReconciliationService } from './application/reconciliation.js';
export { ReservationService } from './application/reservations.js';
export { BillingLifecycle, SIGNUP_BONUS_REASON } from './application/lifecycle.js';
export {
  DEFAULT_BACKGROUND_DAILY_LIMIT_MICROS,
  DEFAULT_LOW_BALANCE_THRESHOLD_MICROS,
  MIN_HOLD_MICROS,
  SAFETY_OVERDRAFT_LIMIT_MICROS_DEFAULT,
} from './domain/rules.js';

export class BillingTestQueries {
  constructor(private readonly database: Database) {}

  async account(userId: string) {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT * FROM billing.accounts WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async platformAccount() {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT * FROM billing.accounts WHERE kind = 'platform'`,
    );
    return rows[0] ?? null;
  }

  async ledgerOf(userId: string) {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT l.* FROM billing.ledger_entries l JOIN billing.accounts a ON a.id = l.account_id
        WHERE a.user_id = $1 ORDER BY l.created_at, l.id`,
      [userId],
    );
    return rows;
  }

  async platformLedger() {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT l.* FROM billing.ledger_entries l JOIN billing.accounts a ON a.id = l.account_id
        WHERE a.kind = 'platform' ORDER BY l.created_at, l.id`,
    );
    return rows;
  }

  async hold(holdId: string) {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT * FROM billing.holds WHERE id = $1`,
      [holdId],
    );
    return rows[0] ?? null;
  }

  async platformBudget(day: string) {
    const { rows } = await this.database.query<Record<string, unknown>>(
      `SELECT * FROM billing.platform_daily_budget WHERE budget_day = $1`,
      [day],
    );
    return rows[0] ?? null;
  }
}
export { PriceService } from './application/prices.js';
export { BillingAdminService } from './application/admin.js';
