/**
 * 公告与更新说明（换壳 UI 批次，契约 3.2 http/announcements.ts）。说明见 docs/backend/announcements.md。
 *
 * - 公告按「状态 = published、在生效期内、平台匹配」实时筛选，不再像旧版那样给每个用户各写一条消息：
 *   可编辑、可撤回，后注册的用户也能看到。已读回执存服务器，所以多端同步。
 * - 更新说明按（平台, 版本号）逐条存；「本版新功能」返回上次看过的版本之后的全部说明，只弹一次。
 * - 版本策略每个平台一行：最新版本、下载地址、最低可用版本号。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type {
  AdminAnnouncement,
  AdminReleaseNote,
  Announcement,
  AppVersionPolicy,
  ReleasePlatform,
  ReleaseNote,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  AppError,
  newId,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import {
  announcementReads,
  announcements,
  appVersionPolicies,
  releaseNoteSeen,
  releaseNotes,
} from '../infra/db/schema.js';

type AnnRow = typeof announcements.$inferSelect;
type NoteRow = typeof releaseNotes.$inferSelect;
type PolicyRow = typeof appVersionPolicies.$inferSelect;

const PLATFORMS: ReleasePlatform[] = ['web', 'android'];
const USER_LIST_LIMIT = 50;
const NOTES_LIMIT = 20;
const WHATS_NEW_LIMIT = 5;

interface AnnouncementInput {
  title: string;
  body: string;
  platforms: ReleasePlatform[];
  startsAt: string | null;
  endsAt: string | null;
  popup: boolean;
  pinned: boolean;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

function checkWindow(startsAt: Date | null, endsAt: Date | null) {
  if (startsAt && endsAt && endsAt <= startsAt)
    throw new AppError('bad_request', '结束时间必须晚于生效时间');
}

@Injectable()
export class AnnouncementService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  // ---------- 用户端 ----------

  async listForUser(
    userId: string,
    platform: ReleasePlatform,
  ): Promise<{ items: Announcement[]; unreadCount: number }> {
    const now = this.clock.now();
    const rows = await this.database.db
      .select({ a: announcements, readAt: announcementReads.readAt })
      .from(announcements)
      .leftJoin(
        announcementReads,
        and(
          eq(announcementReads.announcementId, announcements.id),
          eq(announcementReads.userId, userId),
        ),
      )
      .where(
        and(
          eq(announcements.status, 'published'),
          sql`(${announcements.startsAt} IS NULL OR ${announcements.startsAt} <= ${now})`,
          sql`(${announcements.endsAt} IS NULL OR ${announcements.endsAt} > ${now})`,
          sql`(cardinality(${announcements.platforms}) = 0 OR ${platform} = ANY(${announcements.platforms}))`,
        ),
      )
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
      .limit(USER_LIST_LIMIT);
    const items = rows.map(({ a, readAt }) => ({
      ...this.fields(a),
      announcementId: a.id,
      publishedAt: (a.publishedAt ?? a.createdAt).toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      readAt: iso(readAt),
    }));
    return { items, unreadCount: items.filter((i) => i.readAt === null).length };
  }

  async markRead(userId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    const existing = await this.database.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(and(inArray(announcements.id, unique), eq(announcements.status, 'published')));
    if (!existing.length) return;
    const now = this.clock.now();
    await this.database.db
      .insert(announcementReads)
      .values(existing.map((r) => ({ announcementId: r.id, userId, readAt: now })))
      .onConflictDoNothing();
  }

  // ---------- 管理端 ----------

  async listAdmin(): Promise<AdminAnnouncement[]> {
    const rows = await this.database.db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt));
    const counts = rows.length
      ? await this.database.db
          .select({ id: announcementReads.announcementId, n: count() })
          .from(announcementReads)
          .where(
            inArray(
              announcementReads.announcementId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(announcementReads.announcementId)
      : [];
    const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
    return rows.map((r) => this.toAdmin(r, byId.get(r.id) ?? 0));
  }

  async create(
    adminId: string,
    input: AnnouncementInput & { publish: boolean },
  ): Promise<AdminAnnouncement> {
    const startsAt = toDate(input.startsAt);
    const endsAt = toDate(input.endsAt);
    checkWindow(startsAt, endsAt);
    const now = this.clock.now();
    const [row] = await this.database.db
      .insert(announcements)
      .values({
        id: newId(),
        title: input.title,
        body: input.body,
        platforms: [...new Set(input.platforms)],
        startsAt,
        endsAt,
        popup: input.popup,
        pinned: input.pinned,
        status: input.publish ? 'published' : 'draft',
        publishedAt: input.publish ? now : null,
        withdrawnAt: null,
        createdBy: adminId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.record(adminId, 'announcement.created', row!.id, { publish: input.publish });
    return this.toAdmin(row!, 0);
  }

  async update(
    adminId: string,
    id: string,
    input: Partial<AnnouncementInput> & { resetReads?: boolean },
  ): Promise<AdminAnnouncement> {
    const row = await this.load(id);
    if (row.status === 'withdrawn')
      throw new AppError('conflict', '已撤回的公告不能编辑，请先重新发布');
    const startsAt = input.startsAt !== undefined ? toDate(input.startsAt) : row.startsAt;
    const endsAt = input.endsAt !== undefined ? toDate(input.endsAt) : row.endsAt;
    checkWindow(startsAt, endsAt);
    const updated = await this.database.transaction(async (tx) => {
      const [next] = await tx.db
        .update(announcements)
        .set({
          title: input.title ?? row.title,
          body: input.body ?? row.body,
          platforms: input.platforms ? [...new Set(input.platforms)] : row.platforms,
          startsAt,
          endsAt,
          popup: input.popup ?? row.popup,
          pinned: input.pinned ?? row.pinned,
          updatedAt: this.clock.now(),
        })
        .where(eq(announcements.id, id))
        .returning();
      if (input.resetReads)
        await tx.db.delete(announcementReads).where(eq(announcementReads.announcementId, id));
      return next!;
    });
    await this.record(adminId, 'announcement.updated', id, { resetReads: !!input.resetReads });
    return this.toAdmin(updated, await this.readCount(id));
  }

  async publish(adminId: string, id: string): Promise<AdminAnnouncement> {
    const row = await this.load(id);
    if (row.status === 'published') return this.toAdmin(row, await this.readCount(id));
    const now = this.clock.now();
    const [next] = await this.database.db
      .update(announcements)
      .set({ status: 'published', publishedAt: now, withdrawnAt: null, updatedAt: now })
      .where(eq(announcements.id, id))
      .returning();
    await this.record(adminId, 'announcement.published', id, {});
    return this.toAdmin(next!, await this.readCount(id));
  }

  async withdraw(adminId: string, id: string): Promise<AdminAnnouncement> {
    const row = await this.load(id);
    if (row.status === 'withdrawn') return this.toAdmin(row, await this.readCount(id));
    const now = this.clock.now();
    const [next] = await this.database.db
      .update(announcements)
      .set({ status: 'withdrawn', withdrawnAt: now, updatedAt: now })
      .where(eq(announcements.id, id))
      .returning();
    await this.record(adminId, 'announcement.withdrawn', id, {});
    return this.toAdmin(next!, await this.readCount(id));
  }

  async remove(adminId: string, id: string): Promise<void> {
    const row = await this.load(id);
    if (row.status === 'published') throw new AppError('conflict', '已发布的公告请先撤回');
    await this.database.db.delete(announcements).where(eq(announcements.id, id));
    await this.record(adminId, 'announcement.deleted', id, {});
  }

  // ---------- 内部 ----------

  private async load(id: string): Promise<AnnRow> {
    const [row] = await this.database.db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id));
    if (!row) throw new AppError('not_found', '公告不存在');
    return row;
  }

  private async readCount(id: string): Promise<number> {
    const [r] = await this.database.db
      .select({ n: count() })
      .from(announcementReads)
      .where(eq(announcementReads.announcementId, id));
    return Number(r?.n ?? 0);
  }

  private fields(a: AnnRow): AnnouncementInput {
    return {
      title: a.title,
      body: a.body,
      platforms: a.platforms.filter((p): p is ReleasePlatform =>
        PLATFORMS.includes(p as ReleasePlatform),
      ),
      startsAt: iso(a.startsAt),
      endsAt: iso(a.endsAt),
      popup: a.popup,
      pinned: a.pinned,
    };
  }

  private toAdmin(a: AnnRow, readCount: number): AdminAnnouncement {
    return {
      ...this.fields(a),
      announcementId: a.id,
      status: a.status as AdminAnnouncement['status'],
      publishedAt: iso(a.publishedAt),
      withdrawnAt: iso(a.withdrawnAt),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      readCount,
    };
  }

  private record(adminId: string, action: string, targetId: string, details: object) {
    return this.audit.record({
      module: 'identity',
      action,
      actorType: 'admin',
      actorId: adminId,
      targetType: 'announcement',
      targetId,
      details: details as Record<string, unknown>,
    });
  }
}

@Injectable()
export class ReleaseService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  // ---------- 用户端 ----------

  async checkVersion(platform: ReleasePlatform, versionCode: number) {
    const policy = await this.policyRow(platform);
    const latestCode = policy?.latestVersionCode ?? null;
    const minCode = policy?.minSupportedVersionCode ?? null;
    const [latestNote] =
      latestCode !== null
        ? await this.database.db
            .select()
            .from(releaseNotes)
            .where(
              and(
                eq(releaseNotes.platform, platform),
                eq(releaseNotes.versionCode, latestCode),
                eq(releaseNotes.published, true),
              ),
            )
        : [];
    return {
      platform,
      latestVersion: policy?.latestVersion ?? null,
      latestVersionCode: latestCode,
      downloadUrl: policy?.downloadUrl ?? null,
      minSupportedVersionCode: minCode,
      updateAvailable: latestCode !== null && latestCode > versionCode,
      updateRequired: minCode !== null && versionCode < minCode,
      forceUpdateMessage: policy?.forceUpdateMessage ?? null,
      latestNote: latestNote ? this.toNote(latestNote) : null,
    };
  }

  async listForUser(userId: string, platform: ReleasePlatform, versionCode: number) {
    const rows = await this.database.db
      .select()
      .from(releaseNotes)
      .where(
        and(
          eq(releaseNotes.platform, platform),
          eq(releaseNotes.published, true),
          lte(releaseNotes.versionCode, versionCode),
        ),
      )
      .orderBy(desc(releaseNotes.versionCode))
      .limit(NOTES_LIMIT);
    const [seen] = await this.database.db
      .select()
      .from(releaseNoteSeen)
      .where(and(eq(releaseNoteSeen.userId, userId), eq(releaseNoteSeen.platform, platform)));
    const lastSeen = seen?.versionCode ?? null;
    const whatsNew =
      lastSeen === null
        ? rows.filter((r) => r.versionCode === versionCode)
        : rows.filter((r) => r.versionCode > lastSeen).slice(0, WHATS_NEW_LIMIT);
    return {
      items: rows.map((r) => this.toNote(r)),
      whatsNew: whatsNew.map((r) => this.toNote(r)),
      lastSeenVersionCode: lastSeen,
    };
  }

  async markSeen(userId: string, platform: ReleasePlatform, versionCode: number): Promise<void> {
    const now = this.clock.now();
    await this.database.db
      .insert(releaseNoteSeen)
      .values({ userId, platform, versionCode, updatedAt: now })
      .onConflictDoUpdate({
        target: [releaseNoteSeen.userId, releaseNoteSeen.platform],
        set: { versionCode, updatedAt: now },
        // 只前进不后退：旧设备上报更低的版本号时不覆盖。
        setWhere: gt(sql`excluded.version_code`, releaseNoteSeen.versionCode),
      });
  }

  // ---------- 管理端：更新说明 ----------

  async listNotes(platform?: ReleasePlatform): Promise<AdminReleaseNote[]> {
    const rows = await this.database.db
      .select()
      .from(releaseNotes)
      .where(platform ? eq(releaseNotes.platform, platform) : undefined)
      .orderBy(asc(releaseNotes.platform), desc(releaseNotes.versionCode));
    return rows.map((r) => this.toAdminNote(r));
  }

  async createNote(
    adminId: string,
    input: {
      platform: ReleasePlatform;
      version: string;
      versionCode: number;
      title: string;
      body: string;
      published: boolean;
    },
  ): Promise<AdminReleaseNote> {
    const now = this.clock.now();
    const [row] = await this.database.db
      .insert(releaseNotes)
      .values({
        id: newId(),
        platform: input.platform,
        version: input.version,
        versionCode: input.versionCode,
        title: input.title,
        body: input.body,
        published: input.published,
        publishedAt: input.published ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('conflict', '这个平台的该版本号已有更新说明');
    await this.record(adminId, 'release_note.created', row.id, {
      platform: input.platform,
      versionCode: input.versionCode,
    });
    return this.toAdminNote(row);
  }

  async updateNote(
    adminId: string,
    id: string,
    input: { version?: string; title?: string; body?: string; published?: boolean },
  ): Promise<AdminReleaseNote> {
    const [row] = await this.database.db.select().from(releaseNotes).where(eq(releaseNotes.id, id));
    if (!row) throw new AppError('not_found', '更新说明不存在');
    const now = this.clock.now();
    const published = input.published ?? row.published;
    const [next] = await this.database.db
      .update(releaseNotes)
      .set({
        version: input.version ?? row.version,
        title: input.title ?? row.title,
        body: input.body ?? row.body,
        published,
        publishedAt: published ? (row.publishedAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(releaseNotes.id, id))
      .returning();
    await this.record(adminId, 'release_note.updated', id, {});
    return this.toAdminNote(next!);
  }

  async deleteNote(adminId: string, id: string): Promise<void> {
    const deleted = await this.database.db
      .delete(releaseNotes)
      .where(eq(releaseNotes.id, id))
      .returning({ id: releaseNotes.id });
    if (!deleted.length) throw new AppError('not_found', '更新说明不存在');
    await this.record(adminId, 'release_note.deleted', id, {});
  }

  // ---------- 管理端：版本策略 ----------

  async listPolicies(): Promise<AppVersionPolicy[]> {
    const rows = await this.database.db.select().from(appVersionPolicies);
    return PLATFORMS.map((p) => this.toPolicy(p, rows.find((r) => r.platform === p) ?? null));
  }

  async updatePolicy(
    adminId: string,
    platform: ReleasePlatform,
    input: Omit<AppVersionPolicy, 'platform' | 'updatedAt'>,
  ): Promise<AppVersionPolicy> {
    if (
      input.minSupportedVersionCode !== null &&
      (input.latestVersionCode === null || input.minSupportedVersionCode > input.latestVersionCode)
    )
      throw new AppError('bad_request', '最低可用版本号不能高于最新版本号');
    if ((input.latestVersion === null) !== (input.latestVersionCode === null))
      throw new AppError('bad_request', '最新版本名和版本号要同时填写或同时清空');
    const now = this.clock.now();
    const values = { ...input, updatedAt: now };
    const [row] = await this.database.db
      .insert(appVersionPolicies)
      .values({ platform, ...values })
      .onConflictDoUpdate({ target: appVersionPolicies.platform, set: values })
      .returning();
    await this.audit.record({
      module: 'identity',
      action: 'app_version_policy.updated',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'app_version_policy',
      targetId: platform,
      details: {
        latestVersionCode: input.latestVersionCode,
        minSupportedVersionCode: input.minSupportedVersionCode,
      },
    });
    return this.toPolicy(platform, row!);
  }

  // ---------- 内部 ----------

  private async policyRow(platform: ReleasePlatform): Promise<PolicyRow | null> {
    const [row] = await this.database.db
      .select()
      .from(appVersionPolicies)
      .where(eq(appVersionPolicies.platform, platform));
    return row ?? null;
  }

  private toPolicy(platform: ReleasePlatform, r: PolicyRow | null): AppVersionPolicy {
    return {
      platform,
      latestVersion: r?.latestVersion ?? null,
      latestVersionCode: r?.latestVersionCode ?? null,
      downloadUrl: r?.downloadUrl ?? null,
      minSupportedVersionCode: r?.minSupportedVersionCode ?? null,
      forceUpdateMessage: r?.forceUpdateMessage ?? null,
      updatedAt: r ? r.updatedAt.toISOString() : null,
    };
  }

  private toNote(r: NoteRow): ReleaseNote {
    return {
      releaseNoteId: r.id,
      platform: r.platform as ReleasePlatform,
      version: r.version,
      versionCode: r.versionCode,
      title: r.title,
      body: r.body,
      publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    };
  }

  private toAdminNote(r: NoteRow): AdminReleaseNote {
    return {
      releaseNoteId: r.id,
      platform: r.platform as ReleasePlatform,
      version: r.version,
      versionCode: r.versionCode,
      title: r.title,
      body: r.body,
      published: r.published,
      publishedAt: iso(r.publishedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private record(adminId: string, action: string, targetId: string, details: object) {
    return this.audit.record({
      module: 'identity',
      action,
      actorType: 'admin',
      actorId: adminId,
      targetType: 'release_note',
      targetId,
      details: details as Record<string, unknown>,
    });
  }
}
