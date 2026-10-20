/**
 * 3.25（G1-7 好感度权益卡死）：这位用户是否付过费（契约 BillingPaidHistoryPort）。
 * 现阶段没有真实支付：充值 = 管理员代充值（admin_grant，不含注册赠送 signup_bonus 与开通会员赠送 membership_bonus）；
 * 开通过 PRO+ = 有会员订单。两者任一即算付过费，一旦付过永久算（不会因会员到期回落）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BillingPaidHistoryPort, Tx } from '@weiban/contracts';
import { asDbTx, DATABASE, type Database } from '../../../platform/index.js';

@Injectable()
export class PaidHistoryService implements BillingPaidHistoryPort {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async hasPaidBefore(userId: string, tx?: Tx): Promise<boolean> {
    const run = tx ? asDbTx(tx) : this.database;
    const result = await run.query<{ paid: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM billing.ledger_entries e
         JOIN billing.accounts a ON a.id = e.account_id
         WHERE a.user_id = $1 AND a.kind = 'user' AND e.type = 'admin_grant'
           AND (e.purpose IS NULL OR e.purpose NOT IN ('signup_bonus', 'membership_bonus'))
       ) OR EXISTS (
         SELECT 1 FROM billing.membership_orders o WHERE o.user_id = $1
       ) AS paid`,
      [userId],
    );
    return result.rows[0]?.paid === true;
  }
}
