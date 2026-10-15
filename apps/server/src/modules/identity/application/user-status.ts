/**
 * 3.15（总对照表 Q11）：我的状态（契约 UserStatusEndpoints、UserStatusReadPort）。
 * 每个用户最多一条，过期后读取时视为没有（不需要清理任务；下次设置时覆盖）。
 * 设置 / 清除后发 identity.profile_updated（changedFields = ['status']），realtime 写 settings.updated(profile)，
 * 其他设备重新拉 GET /me/status。账号删除时随外键级联删除。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  SetUserStatusRequest,
  USER_STATUS_PRESETS,
  type UserStatus,
  type UserStatusPreset,
  type UserStatusReadPort,
} from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import {
  AppError,
  nextLocalMidnight,
  safeTimeZone,
  CLOCK,
  DATABASE,
  OUTBOX,
  parseContract,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { profiles, users, userStatuses } from '../infra/db/schema.js';

type StatusRow = typeof userStatuses.$inferSelect;

const DEFAULT_MINUTES = 24 * 60;

export function toUserStatus(row: StatusRow): UserStatus {
  const meta = USER_STATUS_PRESETS.find((p) => p.preset === row.preset) ?? {
    preset: 'custom' as UserStatusPreset,
    label: '自定义',
    emoji: '💭',
    quiet: false,
  };
  return {
    preset: meta.preset,
    text: row.text,
    label: (row.text || meta.label).slice(0, 20),
    emoji: meta.emoji,
    quiet: meta.quiet,
    setAt: row.setAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

@Injectable()
export class UserStatusService implements UserStatusReadPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getUserStatus(userId: string): Promise<UserStatus | null> {
    const [row] = await this.database.db
      .select()
      .from(userStatuses)
      .where(eq(userStatuses.userId, userId));
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= this.clock.nowMs()) return null;
    return toUserStatus(row);
  }

  async set(userId: string, input: unknown): Promise<{ status: UserStatus }> {
    const body = parseContract(SetUserStatusRequest, input);
    const text = body.text?.trim() || null;
    if (body.preset === 'custom' && !text) throw new AppError('bad_request', '请写下你的状态');
    const row = await this.database.transaction(async (tx) => {
      const [user] = await tx.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!user || user.status !== 'active') throw new AppError('not_found', '账号不存在');
      const now = this.clock.now();
      let expiresAt: Date | null;
      const d = body.duration ?? { kind: 'minutes' as const, minutes: DEFAULT_MINUTES };
      if (d.kind === 'forever') expiresAt = null;
      else if (d.kind === 'minutes') expiresAt = new Date(now.getTime() + d.minutes * 60_000);
      else {
        const [p] = await tx.db
          .select({ timeZone: profiles.timeZone })
          .from(profiles)
          .where(eq(profiles.userId, userId));
        expiresAt = nextLocalMidnight(now, safeTimeZone(p?.timeZone));
      }
      const values = { userId, preset: body.preset, text, setAt: now, expiresAt };
      const [saved] = await tx.db
        .insert(userStatuses)
        .values(values)
        .onConflictDoUpdate({
          target: userStatuses.userId,
          set: { preset: values.preset, text, setAt: now, expiresAt },
        })
        .returning();
      await this.outbox.publish(tx, 'identity.profile_updated', 'identity', {
        userId,
        changedFields: ['status'],
      });
      return saved!;
    });
    return { status: toUserStatus(row) };
  }

  async clear(userId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [user] = await tx.db
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId))
        .for('update');
      if (!user || user.status !== 'active') throw new AppError('not_found', '账号不存在');
      const gone = await tx.db
        .delete(userStatuses)
        .where(eq(userStatuses.userId, userId))
        .returning({ userId: userStatuses.userId });
      if (gone.length)
        await this.outbox.publish(tx, 'identity.profile_updated', 'identity', {
          userId,
          changedFields: ['status'],
        });
    });
  }
}
