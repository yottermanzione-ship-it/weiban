/**
 * 我的资料（ACC-02）、全局通知与免打扰（ACC-03）、界面偏好（SVC-01 第 7 条），以及 IdentityReadPort。
 *
 * 修改规则（Q-001）：只改请求里出现的字段，没出现的保持原值，绝不补默认值。
 * 值与原来完全相同的修改不写库、不发事件（同一请求重复发送只生效一次）。
 * 有变化时在同一事务发布事件：identity.profile_updated / notification_settings_updated / preferences_updated；
 * realtime（D-L1-01）订阅后写 settings.updated，用户其他设备据此重新拉取。
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  AccountStatus,
  AppTheme,
  IdentityAccountStatusPort,
  IdentityReadPort,
  NotificationSettings,
  Profile,
  UpdateProfileRequest,
  UpdateUserPreferencesRequest,
  UserPreferences,
} from '@weiban/contracts';
import { UpdateNotificationSettingsRequest } from '@weiban/contracts';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { isValidTimeZone } from '../domain/rules.js';
import { notificationSettings, preferences, profiles, users } from '../infra/db/schema.js';

type ProfileRow = typeof profiles.$inferSelect;
type NotificationRow = typeof notificationSettings.$inferSelect;
type PreferencesRow = typeof preferences.$inferSelect;
export type UpdateNotificationSettings = z.infer<typeof UpdateNotificationSettingsRequest>;

/** 新账号的默认设置（ACC-03；主动来电默认关见 MED-07，允许拉群默认开见 SOC-06 第 4 条）。 */
export const DEFAULT_NOTIFICATION_SETTINGS = {
  proactiveMessagesEnabled: true,
  proactiveCallsEnabled: false,
  pushSoundEnabled: true,
  pushShowContent: true,
  dndEnabled: false,
  dndStart: '00:00',
  dndEnd: '08:00',
  allowCharacterGroupInvites: true,
} as const;

/** 新账号的默认主题（契约 UserPreferences：新账号为 green）。 */
export const DEFAULT_THEME: AppTheme = 'green';

export function toProfile(row: ProfileRow): Profile {
  return {
    nickname: row.nickname,
    avatarMediaId: row.avatarMediaId,
    birthday: row.birthday,
    gender: row.gender as Profile['gender'],
    city: row.city,
    about: row.about,
    timeZone: row.timeZone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNotificationSettings(row: NotificationRow): NotificationSettings {
  return {
    proactiveMessagesEnabled: row.proactiveMessagesEnabled,
    proactiveCallsEnabled: row.proactiveCallsEnabled,
    pushSoundEnabled: row.pushSoundEnabled,
    pushShowContent: row.pushShowContent,
    doNotDisturb: { enabled: row.dndEnabled, start: row.dndStart, end: row.dndEnd },
    allowCharacterGroupInvites: row.allowCharacterGroupInvites,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPreferences(row: PreferencesRow): UserPreferences {
  return { theme: row.theme as AppTheme, updatedAt: row.updatedAt.toISOString() };
}

/** 契约字段名 → 本次是否真的变了。 */
function changedKeys<P extends object>(
  current: { [K in keyof P]: unknown },
  patch: P,
): Array<keyof P> {
  return (Object.keys(patch) as Array<keyof P>).filter(
    (key) =>
      patch[key] !== undefined && JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
  );
}

@Injectable()
export class SettingsService implements IdentityReadPort, IdentityAccountStatusPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 注册时在同一事务写入资料、通知设置、界面偏好的默认值。 */
  async createDefaults(tx: DbTx, userId: string, timeZone: string): Promise<void> {
    const now = this.clock.now();
    await tx.db.insert(profiles).values({
      userId,
      nickname: null,
      avatarMediaId: null,
      birthday: null,
      gender: 'unspecified',
      city: null,
      about: null,
      timeZone,
      updatedAt: now,
    });
    await tx.db
      .insert(notificationSettings)
      .values({ userId, ...DEFAULT_NOTIFICATION_SETTINGS, updatedAt: now });
    await tx.db.insert(preferences).values({ userId, theme: DEFAULT_THEME, updatedAt: now });
  }

  // ---------- 资料 ----------

  async getProfile(userId: string): Promise<Profile | null> {
    const [row] = await this.database.db.select().from(profiles).where(eq(profiles.userId, userId));
    return row ? toProfile(row) : null;
  }

  async requireProfile(userId: string): Promise<Profile> {
    const profile = await this.getProfile(userId);
    if (!profile) throw new AppError('not_found', '账号不存在');
    return profile;
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<Profile> {
    if (patch.timeZone !== undefined && !isValidTimeZone(patch.timeZone)) {
      throw invalidTimeZone('timeZone');
    }
    return this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .for('update');
      if (!row) throw new AppError('not_found', '账号不存在');
      const current = toProfile(row);
      const changed = changedKeys(current, patch);
      if (changed.length === 0) return current;
      const set: Partial<ProfileRow> = { updatedAt: this.clock.now() };
      for (const key of changed) Object.assign(set, { [key]: patch[key] });
      const [updated] = await tx.db
        .update(profiles)
        .set(set)
        .where(eq(profiles.userId, userId))
        .returning();
      await this.outbox.publish(tx, 'identity.profile_updated', 'identity', {
        userId,
        changedFields: changed.map(String),
      });
      return toProfile(updated as ProfileRow);
    });
  }

  // ---------- 通知设置 ----------

  async getNotificationSettings(userId: string): Promise<NotificationSettings | null> {
    const [row] = await this.database.db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, userId));
    return row ? toNotificationSettings(row) : null;
  }

  async requireNotificationSettings(userId: string): Promise<NotificationSettings> {
    const settings = await this.getNotificationSettings(userId);
    if (!settings) throw new AppError('not_found', '账号不存在');
    return settings;
  }

  async updateNotificationSettings(
    userId: string,
    patch: UpdateNotificationSettings,
  ): Promise<NotificationSettings> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(notificationSettings)
        .where(eq(notificationSettings.userId, userId))
        .for('update');
      if (!row) throw new AppError('not_found', '账号不存在');
      const current = toNotificationSettings(row);
      const changed = changedKeys(current, patch);
      if (changed.length === 0) return current;
      const set: Partial<NotificationRow> = { updatedAt: this.clock.now() };
      for (const key of changed) {
        if (key === 'doNotDisturb' && patch.doNotDisturb) {
          set.dndEnabled = patch.doNotDisturb.enabled;
          set.dndStart = patch.doNotDisturb.start;
          set.dndEnd = patch.doNotDisturb.end;
        } else {
          Object.assign(set, { [key]: patch[key] });
        }
      }
      const [updated] = await tx.db
        .update(notificationSettings)
        .set(set)
        .where(eq(notificationSettings.userId, userId))
        .returning();
      await this.outbox.publish(tx, 'identity.notification_settings_updated', 'identity', {
        userId,
      });
      return toNotificationSettings(updated as NotificationRow);
    });
  }

  // ---------- 界面偏好 ----------

  async getPreferences(userId: string): Promise<UserPreferences> {
    const [row] = await this.database.db
      .select()
      .from(preferences)
      .where(eq(preferences.userId, userId));
    if (!row) throw new AppError('not_found', '账号不存在');
    return toPreferences(row);
  }

  async updatePreferences(
    userId: string,
    patch: UpdateUserPreferencesRequest,
  ): Promise<UserPreferences> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(preferences)
        .where(eq(preferences.userId, userId))
        .for('update');
      if (!row) throw new AppError('not_found', '账号不存在');
      const current = toPreferences(row);
      const changed = changedKeys(current, patch);
      if (changed.length === 0) return current;
      const [updated] = await tx.db
        .update(preferences)
        .set({ ...(patch.theme ? { theme: patch.theme } : {}), updatedAt: this.clock.now() })
        .where(eq(preferences.userId, userId))
        .returning();
      // realtime（D-L1-01）订阅后写 settings.updated(section = preferences)，其他设备重新拉取
      await this.outbox.publish(tx, 'identity.preferences_updated', 'identity', { userId });
      return toPreferences(updated as PreferencesRow);
    });
  }

  // ---------- IdentityReadPort ----------

  async getLastActiveAt(userId: string): Promise<string | null> {
    const [row] = await this.database.db
      .select({ lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId));
    return row?.lastActiveAt?.toISOString() ?? null;
  }

  // ---------- IdentityAccountStatusPort（契约 1.2） ----------

  /** 账号状态：active / deleting；账号不存在（已删除或从未存在）返回 null。 */
  async getAccountStatus(userId: string): Promise<AccountStatus | null> {
    const [row] = await this.database.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    return (row?.status as AccountStatus | undefined) ?? null;
  }
}

export function invalidTimeZone(path: string): AppError {
  return new AppError('bad_request', '请求参数不正确', {
    details: { issues: [{ path, message: '不是有效的 IANA 时区名' }] },
  });
}
