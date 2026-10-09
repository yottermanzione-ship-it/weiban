/**
 * health 的生命周期：注销删除清单（UserDataOwner）与角色删除时撤销授权（health-data.md 第 6 节）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import {
  DATABASE,
  EVENT_BUS,
  USER_DATA_REGISTRY,
  type Database,
  type DbTx,
  type EventBus,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { grants, periodEntries, periodSettings } from '../infra/db/schema.js';

@Injectable()
export class HealthLifecycle implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      module: 'health',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
    // 角色被删除（软删除或彻底删除）：授权自动撤销；30 天内恢复也不自动恢复授权（PLAY-01 边界情况）。
    this.bus.subscribe({
      consumer: 'health.on_contact_removed',
      eventType: 'contacts.contact_removed',
      handle: (event, tx) => this.revoke(tx, event.payload.userId, event.payload.characterId),
    });
    this.bus.subscribe({
      consumer: 'health.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: (event, tx) => this.revoke(tx, event.payload.userId, event.payload.characterId),
    });
  }

  private async revoke(tx: DbTx, userId: string, characterId: string): Promise<void> {
    await tx.db
      .delete(grants)
      .where(and(eq(grants.userId, userId), eq(grants.characterId, characterId)));
  }

  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const a = await tx.db
        .delete(periodEntries)
        .where(eq(periodEntries.userId, userId))
        .returning({ id: periodEntries.id });
      const b = await tx.db
        .delete(periodSettings)
        .where(eq(periodSettings.userId, userId))
        .returning({ id: periodSettings.userId });
      const c = await tx.db
        .delete(grants)
        .where(eq(grants.userId, userId))
        .returning({ id: grants.characterId });
      return a.length + b.length + c.length;
    });
  }

  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: count() })
      .from(periodEntries)
      .where(eq(periodEntries.userId, userId));
    const [b] = await this.db.db
      .select({ n: count() })
      .from(periodSettings)
      .where(eq(periodSettings.userId, userId));
    const [c] = await this.db.db
      .select({ n: count() })
      .from(grants)
      .where(eq(grants.userId, userId));
    return (a?.n ?? 0) + (b?.n ?? 0) + (c?.n ?? 0);
  }
}
