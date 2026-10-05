/**
 * model-access 的启动登记：删除清单（注销账号，security-and-privacy.md 5.1；billing.md 10.1 第 9 条）
 * 、事件订阅（角色被彻底删除时删掉该角色的单独模型设置，5.2 节）与每日用量对账定时任务。
 *
 * 删除清单范围：该用户的全局模型选择、角色单独模型、用量记录（含 user_id = 该用户的平台账户调用记录，
 * 即该管理员发起的 admin_* 调用）。上游与模型目录是平台数据，不属于任何用户。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
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
import { characterOverrides, selections, usageRecords } from '../infra/db/schema.js';
import { UsageReconciliationService } from './reconciliation.js';

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
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register(this);
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
      return a.length + b.length + c.length;
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
    return (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0);
  }
}
