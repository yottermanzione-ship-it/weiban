import { Inject, Injectable } from '@nestjs/common';
import type { BillingUsageRefundPort } from '@weiban/contracts';
import { DATABASE, type Database } from '../../../platform/index.js';
import { Ledger } from './ledger.js';

/**
 * 模型调用已被网关扣费，但业务侧（如摘要校验/写回）判定结果不可用时，
 * 给用户原路退回这一笔。幂等键 `refund:usage:<usageRecordId>`，重复调用不会再退。
 */
@Injectable()
export class UsageRefundService implements BillingUsageRefundPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
  ) {}

  async refundUsage(usageRecordId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const charge = await this.ledger.findChargeByUsage(tx, usageRecordId);
      if (!charge || charge.absorbed || charge.amountMicros >= 0) return;
      const key = `refund:usage:${usageRecordId}`;
      const account = await this.ledger.lockAccountById(tx, charge.accountId);
      if (account.kind !== 'user' || (await this.ledger.findByIdempotencyKey(tx, key))) return;
      await this.ledger.postEntry(tx, account, {
        type: 'refund',
        amountMicros: -charge.amountMicros,
        idempotencyKey: key,
        usageRecordId,
        purpose: charge.purpose,
        modelKey: charge.modelKey,
        characterId: charge.characterId,
        priceVersionId: charge.priceVersionId,
        upstreamId: charge.upstreamId,
        costMicros: charge.costMicros,
        reason: reason.slice(0, 200),
      });
    });
  }
}
