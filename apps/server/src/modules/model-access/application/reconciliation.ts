/**
 * 对账第 ② 层：用量记录 ↔ 扣费流水（billing.md 8.2 节，ADR-0017 第 2 条，契约 1.3）。
 * 每天 3:45（北京时间）对前一天运行；billing 在 3:30 跑第 ①、③ 层。
 *
 * 步骤：
 * 1. 取当天（北京时间）创建、已结束的用量记录；
 * 2. 补写缺失的金额快照（进程在结算后、写快照前崩溃）：按 billing 返回的扣费写回，计入 snapshotsRepaired；
 * 3. 取当天写入的全部扣费（listChargesByDay，分页），按 usageRecordId 精确匹配；当天对不上的再按 ID 查一次
 *    （跨零点的调用），不按日期判定缺失；
 * 4. 统计 usageWithoutCharge / chargeWithoutUsage / amountMismatch，发 model_access.usage_reconciled；
 *    有异常时同事务发 platform.admin_alert_raised（reconciliation_flagged），并写审计（含最多 50 个记录 ID）和错误日志。
 * 只读 billing（经 BillingChargeQueryPort），不改任何钱；不自动修复金额不一致。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { UsageCharge } from '@weiban/contracts';
import { and, gte, inArray, lt } from 'drizzle-orm';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  LOGGER,
  OUTBOX,
  type AuditLog,
  type Clock,
  type Database,
  type Logger,
  type Outbox,
} from '../../../platform/index.js';
import { beijingDayRange, previousBeijingDay } from '../domain/rules.js';
import { usageRecords } from '../infra/db/schema.js';
import { MODEL_ACCESS_CHARGE_QUERY, type ChargeQuery } from '../tokens.js';
import { ChargeQueryUnavailableError } from './defaults.js';
import { UsageRecorder } from './usage.js';

type UsageRow = typeof usageRecords.$inferSelect;

/** 契约限制：getChargesByUsageRecordIds 一次最多 1,000 个 ID。 */
const ID_BATCH = 1000;
const PAGE_LIMIT = 1000;
/** 审计里最多列出的异常记录 ID 数。 */
const SAMPLE = 50;

export interface UsageReconciliationResult {
  day: string;
  usageWithoutCharge: number;
  chargeWithoutUsage: number;
  amountMismatch: number;
  snapshotsRepaired: number;
  checkedAt: string;
}

@Injectable()
export class UsageReconciliationService {
  private readonly log: Logger;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(UsageRecorder) private readonly recorder: UsageRecorder,
    @Inject(MODEL_ACCESS_CHARGE_QUERY) private readonly charges: ChargeQuery,
    @Inject(LOGGER) logger: Logger,
  ) {
    this.log = logger.child({ module: 'model_access' });
  }

  /** 定时任务入口：对前一天（北京时间）对账。计费查询端口未接入时跳过并记错误日志。 */
  async runForYesterday(): Promise<UsageReconciliationResult | null> {
    try {
      return await this.run(previousBeijingDay(this.clock.now()));
    } catch (error) {
      if (error instanceof ChargeQueryUnavailableError) {
        this.log.error('计费查询端口尚未接入，用量对账（第 ② 层）未运行');
        return null;
      }
      throw error;
    }
  }

  async run(day: string): Promise<UsageReconciliationResult> {
    const { from, to } = beijingDayRange(day);
    let records = await this.database.db
      .select()
      .from(usageRecords)
      .where(
        and(
          gte(usageRecords.createdAt, from),
          lt(usageRecords.createdAt, to),
          inArray(usageRecords.status, ['succeeded', 'failed']),
        ),
      );

    // ② 补写缺失的金额快照
    const missing = records.filter((r) => r.snapshotAt === null);
    let snapshotsRepaired = 0;
    if (missing.length > 0) {
      const found = await this.chargesFor(missing.map((r) => r.id));
      for (const r of missing) {
        const cs = found.get(r.id) ?? [];
        const charge = cs.find((c) => !c.absorbed);
        const absorbed = cs.find((c) => c.absorbed);
        if (r.status === 'succeeded' && charge) {
          await this.recorder.writeSettleSnapshot(r.id, {
            ledgerEntryId: charge.ledgerEntryId,
            amountMicros: charge.amountMicros,
            costMicros: charge.costMicros,
          });
          snapshotsRepaired += 1;
        } else if (r.status === 'failed' && absorbed) {
          await this.recorder.writeReleaseSnapshot(r.id, {
            absorbedCostMicros: absorbed.amountMicros,
          });
          snapshotsRepaired += 1;
        }
      }
      if (snapshotsRepaired > 0) {
        records = await this.database.db
          .select()
          .from(usageRecords)
          .where(
            inArray(
              usageRecords.id,
              records.map((r) => r.id),
            ),
          );
      }
    }

    // ③ 当天的扣费 + 跨零点的补查
    const byUsage = new Map<string, UsageCharge[]>();
    const dayCharges: UsageCharge[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.charges.listChargesByDay(day, { cursor, limit: PAGE_LIMIT });
      dayCharges.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    for (const c of dayCharges) push(byUsage, c);
    const notFoundToday = records.filter((r) => !byUsage.has(r.id)).map((r) => r.id);
    // 这些 ID 当天没有任何扣费，所以补查结果不会与上面重复
    for (const cs of (await this.chargesFor(notFoundToday)).values()) {
      for (const c of cs) push(byUsage, c);
    }

    // ④ 比对
    const usageWithoutCharge: string[] = [];
    const amountMismatch: string[] = [];
    for (const r of records) {
      const cs = byUsage.get(r.id) ?? [];
      if (r.status === 'succeeded') {
        const charge = cs.find((c) => !c.absorbed);
        if (!charge) usageWithoutCharge.push(r.id);
        else if (!snapshotMatches(r, charge)) amountMismatch.push(r.id);
      } else {
        const absorbed = cs.find((c) => c.absorbed);
        if (cs.some((c) => !c.absorbed))
          amountMismatch.push(r.id); // 失败调用不应向用户收费
        else if (absorbed && absorbed.amountMicros !== r.absorbedCostMicros)
          amountMismatch.push(r.id);
      }
    }
    // 当天的扣费找不到对应的（已结束）用量记录：先看本地是否有这条记录（可能在别的日期创建）
    const ourIds = new Set(records.map((r) => r.id));
    const foreignIds = [...new Set(dayCharges.map((c) => c.usageRecordId))].filter(
      (id) => !ourIds.has(id),
    );
    const known = await this.existing(foreignIds);
    const chargeWithoutUsage = dayCharges
      .filter((c) => {
        if (ourIds.has(c.usageRecordId)) return false;
        const row = known.get(c.usageRecordId);
        if (!row) return true;
        return c.absorbed ? row.status !== 'failed' : row.status !== 'succeeded';
      })
      .map((c) => c.ledgerEntryId);

    const checkedAt = this.clock.now().toISOString();
    const result: UsageReconciliationResult = {
      day,
      usageWithoutCharge: usageWithoutCharge.length,
      chargeWithoutUsage: chargeWithoutUsage.length,
      amountMismatch: amountMismatch.length,
      snapshotsRepaired,
      checkedAt,
    };
    const flagged =
      result.usageWithoutCharge + result.chargeWithoutUsage + result.amountMismatch > 0;

    await this.database.transaction(async (tx) => {
      await this.outbox.publish(tx, 'model_access.usage_reconciled', 'model_access', result);
      if (flagged) {
        await this.outbox.publish(tx, 'platform.admin_alert_raised', 'model_access', {
          kind: 'reconciliation_flagged',
          severity: 'warning',
          dedupeKey: `reconciliation_flagged:${day}:usage`,
          summary: `${day} 用量与扣费对账发现异常：缺扣费 ${result.usageWithoutCharge} 条、多扣费 ${result.chargeWithoutUsage} 条、金额不一致 ${result.amountMismatch} 条`,
          refs: { day },
        });
        await this.audit.record(
          {
            module: 'model_access',
            action: 'usage.reconciliation_flagged',
            actorType: 'system',
            targetType: 'usage_reconciliation',
            targetId: null,
            details: {
              ...result,
              usageWithoutChargeIds: usageWithoutCharge.slice(0, SAMPLE),
              chargeWithoutUsageLedgerIds: chargeWithoutUsage.slice(0, SAMPLE),
              amountMismatchIds: amountMismatch.slice(0, SAMPLE),
            },
          },
          tx,
        );
      }
    });
    if (flagged) this.log.error({ ...result }, '用量与扣费对账发现异常');
    else this.log.info({ ...result }, '用量与扣费对账完成');
    return result;
  }

  private async chargesFor(ids: readonly string[]): Promise<Map<string, UsageCharge[]>> {
    const out = new Map<string, UsageCharge[]>();
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const batch = ids.slice(i, i + ID_BATCH);
      for (const c of await this.charges.getChargesByUsageRecordIds(batch)) push(out, c);
    }
    return out;
  }

  private async existing(ids: readonly string[]): Promise<Map<string, UsageRow>> {
    const out = new Map<string, UsageRow>();
    for (let i = 0; i < ids.length; i += ID_BATCH) {
      const rows = await this.database.db
        .select()
        .from(usageRecords)
        .where(inArray(usageRecords.id, ids.slice(i, i + ID_BATCH)));
      for (const r of rows) out.set(r.id, r);
    }
    return out;
  }
}

function push(map: Map<string, UsageCharge[]>, c: UsageCharge): void {
  const list = map.get(c.usageRecordId);
  if (list) list.push(c);
  else map.set(c.usageRecordId, [c]);
}

function snapshotMatches(r: UsageRow, c: UsageCharge): boolean {
  return (
    r.chargedMicros === c.amountMicros &&
    r.costMicros === c.costMicros &&
    (r.ledgerEntryId === null || r.ledgerEntryId === c.ledgerEntryId)
  );
}
