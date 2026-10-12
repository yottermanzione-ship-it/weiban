/**
 * 成就（GRW-06，T-076）。
 * - 只统计「是否发生、发生了几次」，不读聊天内容（第 7 条）；
 * - 已获得的永不收回：删除角色不删除获得记录，只在注销账号时清除（第 5 条）；
 * - 获得时发 growth.achievement_unlocked 并写 data.changed(achievements)，客户端据此弹 3 秒轻提示（第 4 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { Achievement, type AchievementKey } from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  OUTBOX,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_KEY, type CounterKey } from '../domain/achievements.js';
import { achievementCounters, achievementUnlocks } from '../infra/db/schema.js';
import { GrowthContext } from './context.js';

@Injectable()
export class AchievementService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(GrowthContext) private readonly ctx: GrowthContext,
  ) {}

  /** 已获得则什么都不做（幂等）；返回是否本次新获得。 */
  async unlock(
    tx: DbTx,
    userId: string,
    key: AchievementKey,
    characterId: string | null = null,
  ): Promise<boolean> {
    const def = ACHIEVEMENT_BY_KEY.get(key);
    if (!def) return false;
    const [have] = await tx.db
      .select({ k: achievementUnlocks.achievementKey })
      .from(achievementUnlocks)
      .where(
        and(eq(achievementUnlocks.userId, userId), eq(achievementUnlocks.achievementKey, key)),
      );
    if (have) return false;
    const inserted = await tx.db
      .insert(achievementUnlocks)
      .values({
        userId,
        achievementKey: key,
        no: def.no,
        characterId,
        unlockedAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ k: achievementUnlocks.achievementKey });
    if (!inserted.length) return false;
    await this.outbox.publish(tx, 'growth.achievement_unlocked', 'growth', {
      userId,
      achievementKey: key,
      no: def.no,
    });
    await this.ctx.dataChanged(tx, userId, 'achievements', characterId, null);
    return true;
  }

  /** 是否已获得（事件处理里先读一下，避免每条消息都写库）。 */
  async has(userId: string, key: AchievementKey, tx?: DbTx): Promise<boolean> {
    const runner = tx?.db ?? this.db.db;
    const [row] = await runner
      .select({ k: achievementUnlocks.achievementKey })
      .from(achievementUnlocks)
      .where(
        and(eq(achievementUnlocks.userId, userId), eq(achievementUnlocks.achievementKey, key)),
      );
    return !!row;
  }

  /** 累加计数（只增不减），达到目标的累计成就随之获得；返回新值。 */
  async bump(
    tx: DbTx,
    userId: string,
    counter: CounterKey,
    delta: number,
    characterId: string | null = null,
  ): Promise<number> {
    const value = await this.writeCounter(tx, userId, counter, delta, 'add');
    await this.checkCounter(tx, userId, counter, value, characterId);
    return value;
  }

  /** 设置「当前值」类计数（例如通讯录同时有几个角色），只保留历史最大值作为进度。 */
  async observe(
    tx: DbTx,
    userId: string,
    counter: CounterKey,
    current: number,
    characterId: string | null = null,
  ): Promise<void> {
    await this.writeCounter(tx, userId, counter, current, 'max');
    await this.checkCounter(tx, userId, counter, current, characterId);
  }

  private async writeCounter(
    tx: DbTx,
    userId: string,
    counter: CounterKey,
    value: number,
    mode: 'add' | 'max',
  ): Promise<number> {
    const now = this.clock.now();
    const [row] = await tx.db
      .insert(achievementCounters)
      .values({ userId, counterKey: counter, value: Math.max(0, value), updatedAt: now })
      .onConflictDoUpdate({
        target: [achievementCounters.userId, achievementCounters.counterKey],
        set: {
          value:
            mode === 'add'
              ? sql`${achievementCounters.value} + ${Math.max(0, value)}`
              : sql`GREATEST(${achievementCounters.value}, ${Math.max(0, value)})`,
          updatedAt: now,
        },
      })
      .returning({ value: achievementCounters.value });
    return row?.value ?? value;
  }

  private async checkCounter(
    tx: DbTx,
    userId: string,
    counter: CounterKey,
    value: number,
    characterId: string | null,
  ): Promise<void> {
    for (const def of ACHIEVEMENTS) {
      if (def.counter?.key === counter && value >= def.counter.target)
        await this.unlock(tx, userId, def.key, characterId);
    }
  }

  /** 成就页（跨角色汇总）：全部 34 个，按 PRD 编号。 */
  async list(userId: string): Promise<{ items: Achievement[] }> {
    const [unlocks, counters] = await Promise.all([
      this.db.db.select().from(achievementUnlocks).where(eq(achievementUnlocks.userId, userId)),
      this.db.db.select().from(achievementCounters).where(eq(achievementCounters.userId, userId)),
    ]);
    const unlockedAt = new Map(unlocks.map((u) => [u.achievementKey, u.unlockedAt]));
    const counterValue = new Map(counters.map((c) => [c.counterKey, c.value]));
    return {
      items: ACHIEVEMENTS.map((def) => {
        const at = unlockedAt.get(def.key);
        const progress = def.counter
          ? {
              current: at
                ? def.counter.target
                : Math.min(def.counter.target, counterValue.get(def.counter.key) ?? 0),
              target: def.counter.target,
            }
          : null;
        return Achievement.parse({
          no: def.no,
          key: def.key,
          name: def.name,
          condition: def.condition,
          group: def.group,
          type: def.type,
          unlockedAt: at ? at.toISOString() : null,
          progress,
        });
      }),
    };
  }

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    const a = await tx.db.delete(achievementUnlocks).where(eq(achievementUnlocks.userId, userId));
    const b = await tx.db.delete(achievementCounters).where(eq(achievementCounters.userId, userId));
    return (a.rowCount ?? 0) + (b.rowCount ?? 0);
  }

  async countUserData(userId: string): Promise<number> {
    const [a] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(achievementUnlocks)
      .where(eq(achievementUnlocks.userId, userId));
    const [b] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(achievementCounters)
      .where(eq(achievementCounters.userId, userId));
    return (a?.n ?? 0) + (b?.n ?? 0);
  }
}
