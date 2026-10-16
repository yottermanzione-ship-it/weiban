import { Inject, Injectable } from '@nestjs/common';
import { BillingAdminEndpoints } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  OUTBOX,
  type AuditLog,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { holds } from '../infra/db/schema.js';
import { Ledger } from './ledger.js';
import { PlatformBudget } from './platform-budget.js';

type Input = z.output<NonNullable<typeof BillingAdminEndpoints.resolveUnknownCost.body>>;

/** 管理员核实凭证后追加差额；从不重新取得用户付款授权。 */
@Injectable()
export class CostResolutionService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(Ledger) private readonly ledger: Ledger,
    @Inject(PlatformBudget) private readonly budget: PlatformBudget,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async resolve(holdId: string, input: Input, operatorUserId: string) {
    // 同时防御非HTTP内部误用；凭证URL只保存，不由服务器访问。
    const body = BillingAdminEndpoints.resolveUnknownCost.body!.parse(input);
    const [initial] = await this.database.db.select().from(holds).where(eq(holds.id, holdId));
    if (!initial) throw new AppError('not_found', '冻结记录不存在');
    return this.database.transaction(async (tx) => {
      const account = await this.ledger.lockAccountById(tx, initial.accountId);
      const platform =
        account.kind === 'platform' ? account : await this.ledger.lockPlatformAccount(tx);
      const [hold] = await tx.db.select().from(holds).where(eq(holds.id, holdId)).for('update');
      if (!hold) throw new AppError('not_found', '冻结记录不存在');
      const risk = hold.riskSnapshot;
      const oldResolution = risk?.resolution;
      if (oldResolution) {
        if (
          oldResolution.costMicros !== body.costMicros ||
          oldResolution.evidenceUrl !== body.evidenceUrl ||
          oldResolution.reason !== body.reason
        )
          throw new AppError('conflict', '该调用已按其他凭证核实，禁止覆盖原核实记录');
        return {
          holdId,
          costMicros: oldResolution.costMicros,
          resolvedAt: oldResolution.resolvedAt,
        };
      }
      if (
        risk?.phase !== 'unknown' ||
        !risk.usageRecordId ||
        !risk.upstreamId ||
        !risk.upstreamModelId
      )
        throw new AppError('conflict', '仅可核实有完整调用关联的未知费用');
      const settlement = hold.status === 'settled' ? hold.settlementSnapshot : null;
      const release = hold.status === 'released' ? hold.releaseSnapshot : null;
      if (
        (!settlement && !release) ||
        settlement?.costKnown === true ||
        release?.costKnown === true
      )
        throw new AppError('conflict', '先恢复关闭调用并生成待核快照，再提交供应商凭证');
      if (account.kind === 'user' && settlement && settlement.amountMicros !== 0)
        throw new AppError('conflict', '历史用户扣费需单独审查，不允许以成本核实覆盖');
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('billing:call-route:' || $1 || ':' || $2, 0))",
        [risk.upstreamId, risk.upstreamModelId],
      );
      const previous = settlement?.costMicros ?? release!.absorbedCostMicros;
      const { rows } = await tx.query<{ cost: string }>(
        "SELECT COALESCE(sum(cost_micros),0)::text AS cost FROM billing.ledger_entries WHERE hold_id=$1 AND type='charge'",
        [holdId],
      );
      if (!Number.isSafeInteger(previous) || Number(rows[0]?.cost) !== previous)
        throw new AppError('conflict', '原成本快照与流水不一致，拒绝自动冲正');
      const delta = body.costMicros - previous;
      const platformSuccess = account.kind === 'platform' && settlement !== null;
      if (!Number.isSafeInteger(platform.balanceMicros - (platformSuccess ? 0 : delta)))
        throw new AppError('bad_request', '成本差额超出安全账务范围');
      const absorbed = platformSuccess ? (settlement.absorbedCostMicros ?? 0) : body.costMicros;
      // 成功平台调用的售价已结，成本变化不能伪装成再次收售价。
      // 其他情况成本全由平台吸收，可含负差额退回；原流水保持不可变。
      if (delta !== 0)
        await this.ledger.postEntry(tx, platform, {
          type: platformSuccess ? 'adjustment' : 'charge',
          amountMicros: platformSuccess ? 0 : -delta,
          costMicros: delta,
          absorbed: !platformSuccess,
          idempotencyKey: `cost_resolution:${hold.id}`,
          usageRecordId: risk.usageRecordId,
          holdId: hold.id,
          purpose: hold.purpose,
          modelKey: hold.modelKey,
          characterId: hold.characterId,
          priceVersionId: hold.priceVersionId,
          upstreamId: risk.upstreamId,
          operatorUserId,
          reason: `供应商成本核实：${body.reason}`,
        });
      await this.budget.resolveUnknown(tx, hold.budgetDay, risk.uncertainMicros);
      const budgetRows = await tx.query<{ settled: string }>(
        'SELECT settled_cost_micros::text AS settled FROM billing.platform_daily_budget WHERE budget_day=$1 FOR UPDATE',
        [hold.budgetDay],
      );
      const nextCost = Number(budgetRows.rows[0]?.settled) + delta;
      if (!budgetRows.rows.length || !Number.isSafeInteger(nextCost) || nextCost < 0)
        throw new AppError('conflict', '平台成本预算账不一致或超出安全范围，拒绝核实');
      await this.budget.settle(tx, hold.budgetDay, 0, delta);
      const resolvedAt = this.clock.now().toISOString();
      const resolution = { ...body, operatorUserId, resolvedAt };
      await tx.db
        .update(holds)
        .set({
          absorbedCostMicros: absorbed,
          ...(settlement
            ? {
                settlementSnapshot: {
                  ...settlement,
                  costMicros: body.costMicros,
                  absorbedCostMicros: absorbed,
                  chargedCostMicros: body.costMicros - absorbed,
                  costKnown: true,
                  uncertainCostMicros: 0,
                  unpricedUnits: [],
                },
              }
            : {
                releaseSnapshot: {
                  ...release!,
                  absorbedCostMicros: absorbed,
                  costKnown: true,
                  uncertainCostMicros: 0,
                  unpricedUnits: [],
                },
              }),
          riskSnapshot: { ...risk, phase: 'resolved', uncertainMicros: 0, resolution },
        })
        .where(eq(holds.id, holdId));
      await this.audit.record(
        {
          module: 'billing',
          action: 'prehold.cost_resolved',
          actorType: 'admin',
          actorId: operatorUserId,
          targetType: 'hold',
          targetId: holdId,
          details: {
            ...resolution,
            previousCostMicros: previous,
            costDeltaMicros: delta,
            platformSuccess,
          },
        },
        tx,
      );
      await this.outbox.publish(tx, 'billing.call_cost_resolved', 'billing', {
        holdId,
        usageRecordId: risk.usageRecordId,
        status: settlement ? 'succeeded' : 'failed',
        chargedMicros: settlement?.amountMicros ?? 0,
        costMicros: body.costMicros,
        absorbedCostMicros: absorbed,
        ledgerEntryId: settlement?.ledgerEntryId ?? null,
        resolvedAt,
      });
      return { holdId, costMicros: body.costMicros, resolvedAt };
    });
  }
}
