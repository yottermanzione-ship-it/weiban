/**
 * 计费只读查询（契约 BillingChargeQueryPort，v1.3）。说明见 docs/backend/billing.md。
 * 只读：不写任何表，不受 R9 限制（目前只有 model-access 使用）。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BillingChargeQueryPort, UsageCharge, UsageChargePage } from '@weiban/contracts';
import { AppError, DATABASE, type Database } from '../../../platform/index.js';
import { addDays, PLATFORM_TIME_ZONE, startOfLocalDay } from '../domain/local-time.js';

const MAX_IDS = 1000;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

interface ChargeRow {
  usage_record_id: string;
  id: string;
  amount: string;
  cost: string | null;
  absorbed: boolean;
  safety_overdraft: boolean;
  created_iso: string;
  created_text: string;
}

const SELECT = `SELECT usage_record_id, id, amount_micros AS amount, cost_micros AS cost, absorbed, safety_overdraft,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_iso,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_text
  FROM billing.ledger_entries`;

function toCharge(r: ChargeRow): UsageCharge {
  return {
    usageRecordId: r.usage_record_id,
    ledgerEntryId: r.id,
    amountMicros: Math.abs(Number(r.amount)),
    costMicros: Number(r.cost ?? 0),
    absorbed: r.absorbed,
    safetyOverdraft: r.safety_overdraft,
    chargedAt: r.created_iso,
  };
}

@Injectable()
export class ChargeQueryService implements BillingChargeQueryPort {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async getChargesByUsageRecordIds(usageRecordIds: readonly string[]): Promise<UsageCharge[]> {
    if (usageRecordIds.length > MAX_IDS) {
      throw new AppError('bad_request', `一次最多查询 ${MAX_IDS} 个用量记录 ID`);
    }
    if (usageRecordIds.length === 0) return [];
    const { rows } = await this.database.query<ChargeRow>(
      `${SELECT} WHERE type = 'charge' AND usage_record_id = ANY($1::uuid[]) ORDER BY created_at, id`,
      [usageRecordIds],
    );
    return rows.map(toCharge);
  }

  async listChargesByDay(
    day: string,
    page?: { cursor?: string; limit?: number },
  ): Promise<UsageChargePage> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new AppError('bad_request', '日期格式应为 YYYY-MM-DD');
    }
    const limit = Math.min(Math.max(page?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const from = startOfLocalDay(day, PLATFORM_TIME_ZONE);
    const to = startOfLocalDay(addDays(day, 1), PLATFORM_TIME_ZONE);
    const params: unknown[] = [from, to, limit + 1];
    let after = '';
    if (page?.cursor) {
      const [ts, id] = Buffer.from(page.cursor, 'base64url').toString('utf8').split('|');
      if (!ts || !id) throw new AppError('bad_request', '游标无效');
      params.push(ts, id);
      after = 'AND (created_at, id) > ($4::timestamptz, $5::uuid)';
    }
    const { rows } = await this.database.query<ChargeRow>(
      `${SELECT} WHERE type = 'charge' AND usage_record_id IS NOT NULL
         AND created_at >= $1 AND created_at < $2 ${after}
         ORDER BY created_at, id LIMIT $3`,
      params,
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(`${last.created_text}|${last.id}`).toString('base64url')
        : null;
    return { items: items.map(toCharge), nextCursor };
  }

  async listActivePricedModelKeys(): Promise<string[]> {
    const { rows } = await this.database.query<{ model_key: string }>(
      `SELECT DISTINCT i.model_key FROM billing.price_items i
         JOIN billing.price_versions v ON v.id = i.price_version_id
        WHERE v.status = 'active' ORDER BY i.model_key`,
    );
    return rows.map((r) => r.model_key);
  }
}
