/**
 * model-access 的启动登记：删除清单（注销账号，security-and-privacy.md 5.1；billing.md 10.1 第 9 条）
 * 、事件订阅（角色被彻底删除时删掉该角色的单独模型设置，5.2 节）与每日用量对账定时任务。
 *
 * 删除清单范围：该用户的全局模型选择、角色单独模型、用量记录（含 user_id = 该用户的平台账户调用记录，
 * 即该管理员发起的 admin_* 调用）。上游与模型目录是平台数据，不属于任何用户。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import type { UserDataOwner } from '@weiban/contracts';
import { and, count, eq } from 'drizzle-orm';
import {
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import {
  characterOverrides,
  selections,
  usageRecords,
  generationResults,
  generationAttempts,
  platformPurposeLimits,
} from '../infra/db/schema.js';
import { UsageReconciliationService } from './reconciliation.js';
import { BillingBoundsService } from './billing-bounds.js';

/** 每天 3:45（北京时间）对前一天做用量对账（billing.md 8.2 第 ② 层；billing 的第 ①③ 层在 3:30）。 */
export const RECONCILE_USAGE_JOB = 'model_access.reconcile_usage';

@Injectable()
export class ModelAccessLifecycle implements OnModuleInit, UserDataOwner {
  readonly module = 'model_access' as const;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(UsageReconciliationService)
    private readonly reconciliation: UsageReconciliationService,
    @Optional() @Inject(BillingBoundsService) private readonly billingBounds?: BillingBoundsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    this.bus.subscribe({
      consumer: 'model_access.on_call_cost_resolved',
      eventType: 'billing.call_cost_resolved',
      handle: async (event, tx) => {
        const p = event.payload;
        const [record] = await tx.db
          .select({ status: usageRecords.status })
          .from(usageRecords)
          .where(and(eq(usageRecords.id, p.usageRecordId), eq(usageRecords.holdId, p.holdId)));
        // 用量尚未结束则重试事件；账号注销删掉的记录不重建。
        if (record && record.status !== p.status)
          throw new Error('调用尚未按权威结算状态结束，稍后重试成本同步');
        await tx.db
          .update(usageRecords)
          .set({
            chargedMicros: p.chargedMicros,
            costMicros: p.costMicros,
            absorbedCostMicros: p.absorbedCostMicros,
            ledgerEntryId: p.ledgerEntryId,
            costKnown: true,
            uncertainCostMicros: 0,
            snapshotAt: new Date(p.resolvedAt),
          })
          .where(
            and(
              eq(usageRecords.id, p.usageRecordId),
              eq(usageRecords.holdId, p.holdId),
              eq(usageRecords.status, p.status),
            ),
          );
      },
    });
    this.bus.subscribe({
      consumer: 'model_access.on_call_cost_unknown',
      eventType: 'billing.call_cost_unknown',
      handle: async (event, tx) => {
        if (!this.billingBounds) throw new Error('计费边界服务不可用，未知风险事件不得确认');
        await this.billingBounds.pauseUnknown(
          event.payload.modelKey,
          event.payload,
          { checkedAt: event.payload.sentAt },
          tx,
        );
      },
    });
    this.bus.subscribe({
      consumer: 'model_access.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: (event, tx) => this.onContactPurged(event.payload, tx),
    });
    await this.jobs.work(RECONCILE_USAGE_JOB, async () => {
      await this.reconciliation.runForYesterday();
    });
    await this.jobs.schedule(RECONCILE_USAGE_JOB, '45 3 * * *');
  }

  /** 角色被彻底删除：删除该用户对该角色的单独模型设置（可重复执行）。 */
  async onContactPurged(payload: { userId: string; characterId: string }, tx: DbTx): Promise<void> {
    await tx.db
      .delete(characterOverrides)
      .where(
        and(
          eq(characterOverrides.userId, payload.userId),
          eq(characterOverrides.characterId, payload.characterId),
        ),
      );
  }

  async purgeUser(userId: string): Promise<number> {
    return this.database.transaction(async (tx) => {
      const a = await tx.db
        .delete(selections)
        .where(eq(selections.userId, userId))
        .returning({ id: selections.userId });
      const b = await tx.db
        .delete(characterOverrides)
        .where(eq(characterOverrides.userId, userId))
        .returning({ id: characterOverrides.userId });
      const c = await tx.db
        .delete(usageRecords)
        .where(eq(usageRecords.userId, userId))
        .returning({ id: usageRecords.id });
      const d = await tx.db
        .delete(generationResults)
        .where(eq(generationResults.userId, userId))
        .returning({ id: generationResults.id });
      const e = await tx.db
        .delete(generationAttempts)
        .where(eq(generationAttempts.userId, userId))
        .returning({ id: generationAttempts.id });
      const f = await tx.db
        .delete(platformPurposeLimits)
        .where(eq(platformPurposeLimits.userId, userId))
        .returning({ id: platformPurposeLimits.userId });
      return a.length + b.length + c.length + d.length + e.length + f.length;
    });
  }

  async countUserData(userId: string): Promise<number> {
    const [a] = await this.database.db
      .select({ n: count() })
      .from(selections)
      .where(eq(selections.userId, userId));
    const [b] = await this.database.db
      .select({ n: count() })
      .from(characterOverrides)
      .where(eq(characterOverrides.userId, userId));
    const [c] = await this.database.db
      .select({ n: count() })
      .from(usageRecords)
      .where(eq(usageRecords.userId, userId));
    const [d] = await this.database.db
      .select({ n: count() })
      .from(generationResults)
      .where(eq(generationResults.userId, userId));
    const [e] = await this.database.db
      .select({ n: count() })
      .from(generationAttempts)
      .where(eq(generationAttempts.userId, userId));
    const [f] = await this.database.db
      .select({ n: count() })
      .from(platformPurposeLimits)
      .where(eq(platformPurposeLimits.userId, userId));
    return (e?.n ?? 0) + (f?.n ?? 0) + (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0) + (d?.n ?? 0);
  }
}
