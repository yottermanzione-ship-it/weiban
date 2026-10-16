/**
 * 契约 3.1（积压 ㉖㉞）：
 * - BillingQuotePort：按当前价目表报价（不冻结、不记账）。调用方只有 model-access（同 R9 的理由：价目表只经网关解释），
 *   令牌 BILLING_QUOTE_PORT 只在 model-access 注入。
 * - BillingDailySpendReadPort：用户某一当地日期按用途汇总的已结算金额（扣费减退款；不含冻结）。任何模块可读。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ModelPurpose,
  type BillingDailySpendReadPort,
  type BillingQuotePort,
  type IdentityReadPort,
  type UsageQuantities,
} from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import { CLOCK, DATABASE, type Clock, type Database } from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { addDays, safeTimeZone, startOfLocalDay } from '../domain/local-time.js';
import { priceUsageCeiling, validUsage } from '../domain/rules.js';
import { accounts } from '../infra/db/schema.js';
import { PriceService } from './prices.js';

@Injectable()
export class BillingQuoteService implements BillingQuotePort, BillingDailySpendReadPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) _clock: Clock,
    @Inject(PriceService) private readonly prices: PriceService,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
  ) {}

  async quote(
    modelKey: string,
    estimate: UsageQuantities,
  ): Promise<{ amountMicros: number; priceVersionId: string } | null> {
    if (!modelKey || !validUsage(estimate)) return null;
    return this.database.transaction(async (tx) => {
      const version = await this.prices.activeVersion(tx);
      if (!version) return null;
      const rows = await this.prices.modelPrices(tx, version.id, modelKey);
      if (!rows.length) return null;
      const priced = priceUsageCeiling(rows, estimate);
      if (!priced.ok || !Number.isSafeInteger(priced.sellMicros)) return null;
      // 与冻结同口径：最高分时/缓存费率；已核零价允许0，不把缺价格当0。
      return {
        amountMicros: priced.sellMicros,
        priceVersionId: version.id,
      };
    });
  }

  async getUserDailySpendByPurpose(
    userId: string,
    localDate: string,
  ): Promise<Partial<Record<ModelPurpose, number>>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return {};
    const [account] = await this.database.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.kind, 'user'), eq(accounts.userId, userId)));
    if (!account) return {};
    const timeZone = safeTimeZone((await this.identity.getProfile(userId))?.timeZone);
    const from = startOfLocalDay(localDate, timeZone);
    const to = startOfLocalDay(addDays(localDate, 1), timeZone);
    // 扣费流水金额为负、退款为正；同一用量记录的退款冲减到原扣费的用途上。
    const { rows } = await this.database.query<{ purpose: string | null; spent: string }>(
      `SELECT c.purpose,
              sum(-c.amount_micros) - coalesce(sum(r.refunded), 0) AS spent
         FROM billing.ledger_entries c
         LEFT JOIN LATERAL (
           SELECT sum(x.amount_micros) AS refunded
             FROM billing.ledger_entries x
            WHERE x.type = 'refund' AND x.usage_record_id IS NOT NULL
              AND x.usage_record_id = c.usage_record_id AND x.account_id = c.account_id
         ) r ON true
        WHERE c.account_id = $1 AND c.type = 'charge' AND c.absorbed = false
          AND c.created_at >= $2 AND c.created_at < $3
        GROUP BY c.purpose`,
      [account.id, from, to],
    );
    const out: Partial<Record<ModelPurpose, number>> = {};
    for (const row of rows) {
      const purpose = ModelPurpose.safeParse(row.purpose);
      const spent = Math.max(0, Number(row.spent ?? 0));
      if (purpose.success && spent > 0) out[purpose.data] = (out[purpose.data] ?? 0) + spent;
    }
    return out;
  }
}
