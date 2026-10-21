/** H4: participant admission, cent-point carry and atomic reimbursement of a single platform call. */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { SharedSearchBillingPort, IdentityAccountStatusPort } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  newId,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { available, Ledger, type AccountRow } from './ledger.js';
import { PriceService } from './prices.js';
import { PostpaidSettingsService } from './postpaid-settings.js';
import { ReservationService } from './reservations.js';
import { applyDiscount, priceUsageCeiling } from '../domain/rules.js';
import {
  roundedSharedCharge,
  sharedSlice,
  SHARED_SEARCH_PURPOSE,
} from '../domain/shared-search.js';
import { localDate } from '../domain/local-time.js';

type Call = {
  id: string;
  character_id: string;
  model_key: string;
  state: 'pending' | 'settled' | 'cancelled';
  member_count: number;
  ceiling_micros: string;
  collected_micros: string;
  usage_record_id: string | null;
  created_at: Date;
  expires_at: Date;
};
@Injectable()
export class SharedSearchBilling implements SharedSearchBillingPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(PriceService) private readonly prices: PriceService,
    @Inject(PostpaidSettingsService) private readonly limits: PostpaidSettingsService,
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT) private readonly identities: IdentityAccountStatusPort,
  ) {}
  private async lock(tx: DbTx, key: string) {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('shared-search:' || $1,0))", [
      key,
    ]);
  }
  async begin(input: Parameters<SharedSearchBillingPort['begin']>[0]) {
    const candidates = [...new Set(input.userIds)].sort();
    if (!candidates.length || candidates.length > 10000 || !input.key || input.key.length > 200)
      return null;
    const allowed: string[] = [];
    for (const userId of candidates)
      if (!(await this.identities.isBanned?.(userId))) allowed.push(userId);
    const limits = await this.limits.limits();
    return this.db.transaction(async (tx) => {
      await this.lock(tx, input.key);
      const old = (
        await tx.query<Call>('SELECT * FROM billing.shared_search_calls WHERE request_key=$1', [
          input.key,
        ])
      ).rows[0];
      if (old) {
        if (old.character_id !== input.characterId) throw new Error('shared key reused');
        if (
          old.state === 'pending' &&
          (old.expires_at <= this.clock.now() || old.model_key !== input.modelKey)
        ) {
          await tx.query(
            "UPDATE billing.shared_search_calls SET state='cancelled' WHERE id=$1 AND state='pending'",
            [old.id],
          );
          return { groupId: old.id, userIds: [], state: 'cancelled' as const };
        }
        const members = await tx.query<{ user_id: string }>(
          'SELECT a.user_id FROM billing.shared_search_members m JOIN billing.accounts a ON a.id=m.account_id WHERE m.call_id=$1 AND a.user_id IS NOT NULL ORDER BY m.ordinal',
          [old.id],
        );
        return { groupId: old.id, userIds: members.rows.map((m) => m.user_id), state: old.state };
      }
      const version = await this.prices.activeVersion(tx);
      if (!version) return null;
      const rows = await this.prices.modelPrices(tx, version.id, input.modelKey);
      const price = priceUsageCeiling(rows, { searchCalls: 1 });
      if (!price.ok) return null;
      const ceiling = applyDiscount(
        price.sellMicros,
        await this.prices.discountBp(tx, input.modelKey, this.clock.now()),
      );
      if (!Number.isSafeInteger(ceiling)) return null;
      const members: AccountRow[] = [];
      // Identity share locks precede wallet locks, matching deletion. No wallets for non-active users.
      const active: string[] = [];
      for (const id of allowed)
        if ((await this.identities.getAccountStatus(id, tx)) === 'active') active.push(id);
      for (const id of active) {
        const account = await this.ledger.lockUserAccount(tx, id);
        if (
          available(account) <= 0 ||
          (await this.reservations.inFlightPaidCalls(tx, account.id)) >=
            limits.maxConcurrentPaidCalls ||
          (await this.reservations.backgroundSpent(
            tx,
            account.id,
            localDate(this.clock.now(), account.timeZone),
          )) +
            ceiling +
            100 >
            account.backgroundDailyLimitMicros
        )
          continue;
        members.push(account);
      }
      // Recompute after exclusions; each member is admitted against the worst share plus rounding carry.
      if (
        !members.length ||
        Math.ceil(ceiling / members.length) + 100 > limits.largeRequestLimitMicros
      )
        return null;
      const id = newId(),
        now = this.clock.now();
      await tx.query(
        `INSERT INTO billing.shared_search_calls(id,request_key,character_id,model_key,state,member_count,ceiling_micros,created_at,expires_at) VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8)`,
        [
          id,
          input.key,
          input.characterId,
          input.modelKey,
          members.length,
          ceiling,
          now,
          new Date(this.clock.nowMs() + 120000),
        ],
      );
      for (const [ordinal, a] of members.entries())
        await tx.query(
          'INSERT INTO billing.shared_search_members(call_id,account_id,ordinal) VALUES($1,$2,$3)',
          [id, a.id, ordinal],
        );
      return { groupId: id, userIds: members.map((a) => a.userId!), state: 'pending' as const };
    });
  }
  async cancel(id: string) {
    await this.db.query(
      "UPDATE billing.shared_search_calls SET state='cancelled' WHERE id=$1 AND state='pending'",
      [id],
    );
  }
  async settle(id: string, usageRecordId: string) {
    return this.db.transaction(async (tx) => {
      const before = (
        await tx.query<Call>('SELECT * FROM billing.shared_search_calls WHERE id=$1', [id])
      ).rows[0];
      if (!before) throw new Error('shared call missing');
      // All mutations acquire the request advisory lock. Source ledger rows are immutable.
      const key = (
        await tx.query<{ request_key: string }>(
          'SELECT request_key FROM billing.shared_search_calls WHERE id=$1',
          [id],
        )
      ).rows[0]!.request_key;
      await this.lock(tx, key);
      const call = (
        await tx.query<Call>('SELECT * FROM billing.shared_search_calls WHERE id=$1 FOR UPDATE', [
          id,
        ])
      ).rows[0]!;
      if (call.state === 'settled') {
        if (call.usage_record_id !== usageRecordId) throw new Error('shared source changed');
        const rows = await tx.query<{ user_id: string; charged_micros: string }>(
          'SELECT a.user_id,m.charged_micros FROM billing.shared_search_members m JOIN billing.accounts a ON a.id=m.account_id WHERE m.call_id=$1 AND a.user_id IS NOT NULL',
          [id],
        );
        return {
          collectedMicros: Number(call.collected_micros),
          userCharges: Object.fromEntries(
            rows.rows.map((r) => [r.user_id, Number(r.charged_micros)]),
          ),
        };
      }
      if (call.state === 'cancelled') return { collectedMicros: 0, userCharges: {} };
      if (call.expires_at <= this.clock.now()) {
        await tx.query("UPDATE billing.shared_search_calls SET state='cancelled' WHERE id=$1", [
          id,
        ]);
        return { collectedMicros: 0, userCharges: {} };
      }
      const source = (
        await tx.query<{ amount_micros: string; created_at: Date }>(
          `SELECT l.amount_micros,l.created_at FROM billing.ledger_entries l JOIN billing.accounts a ON a.id=l.account_id WHERE l.usage_record_id=$1 AND a.kind='platform' AND l.type='charge' AND NOT l.absorbed AND l.purpose='admin_public_update_search' AND l.character_id=$2 AND l.model_key=$3`,
          [usageRecordId, call.character_id, call.model_key],
        )
      ).rows[0];
      if (!source || source.created_at < call.created_at)
        throw new Error('shared source not authorized');
      const total = Math.max(
        0,
        Math.min(-Number(source.amount_micros), Number(call.ceiling_micros)),
      );
      const raw = (
        await tx.query<{ account_id: string; user_id: string; ordinal: number }>(
          `SELECT m.account_id,a.user_id,m.ordinal FROM billing.shared_search_members m JOIN billing.accounts a ON a.id=m.account_id WHERE m.call_id=$1 AND a.user_id IS NOT NULL ORDER BY a.user_id`,
          [id],
        )
      ).rows;
      const active: typeof raw = [];
      for (const m of raw)
        if ((await this.identities.getAccountStatus(m.user_id, tx)) === 'active') active.push(m);
      const users: { account: AccountRow; ordinal: number }[] = [];
      for (const m of active)
        users.push({
          account: await this.ledger.lockAccountById(tx, m.account_id),
          ordinal: m.ordinal,
        });
      const platform = await this.ledger.lockPlatformAccount(tx);
      let collected = 0;
      const userCharges: Record<string, number> = {};
      const offset =
        parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) % call.member_count;
      for (const { account, ordinal } of users) {
        const old =
          (
            await tx.query<{ carry_micros: number }>(
              'SELECT carry_micros FROM billing.shared_search_carries WHERE account_id=$1 AND character_id=$2',
              [account.id, call.character_id],
            )
          ).rows[0]?.carry_micros ?? 0;
        const rounded = roundedSharedCharge(
          sharedSlice(total, call.member_count, ordinal, offset),
          old,
        );
        await tx.query(
          `INSERT INTO billing.shared_search_carries(account_id,character_id,carry_micros) VALUES($1,$2,$3) ON CONFLICT(account_id,character_id) DO UPDATE SET carry_micros=EXCLUDED.carry_micros`,
          [account.id, call.character_id, rounded.carry],
        );
        if (rounded.charge > 0) {
          if (!Number.isSafeInteger(collected + rounded.charge))
            throw new Error('shared search collection exceeds safe integer range');
          await this.ledger.postEntry(tx, account, {
            type: 'charge',
            amountMicros: -rounded.charge,
            idempotencyKey: `weibo-share:${id}:${account.id}`,
            purpose: SHARED_SEARCH_PURPOSE,
            characterId: call.character_id,
            modelKey: call.model_key,
            costMicros: 0,
            allowNegative: true,
            reason: '微博同步搜索分摊（含累计尾差）',
          });
          const day = localDate(this.clock.now(), account.timeZone);
          await tx.query(
            `INSERT INTO billing.daily_spend(account_id,day,background_settled_micros,total_charged_micros) VALUES($1,$2,$3,$3) ON CONFLICT(account_id,day) DO UPDATE SET background_settled_micros=billing.daily_spend.background_settled_micros+EXCLUDED.background_settled_micros,total_charged_micros=billing.daily_spend.total_charged_micros+EXCLUDED.total_charged_micros`,
            [account.id, day, rounded.charge],
          );
          collected += rounded.charge;
          userCharges[account.userId!] = rounded.charge;
          await tx.query(
            'UPDATE billing.shared_search_members SET charged_micros=$3 WHERE call_id=$1 AND account_id=$2',
            [id, account.id, rounded.charge],
          );
        }
      }
      if (collected > 0)
        await this.ledger.postEntry(tx, platform, {
          type: 'adjustment',
          amountMicros: collected,
          idempotencyKey: `weibo-recovery:${id}`,
          characterId: call.character_id,
          purpose: SHARED_SEARCH_PURPOSE,
          costMicros: 0,
          reason: '微博同步用户分摊回收',
        });
      await tx.query(
        "UPDATE billing.shared_search_calls SET state='settled',usage_record_id=$2,collected_micros=$3 WHERE id=$1",
        [id, usageRecordId, collected],
      );
      return { collectedMicros: collected, userCharges };
    });
  }
}
