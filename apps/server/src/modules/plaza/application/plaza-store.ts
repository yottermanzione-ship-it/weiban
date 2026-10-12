/**
 * plaza 共用的读取与组装（T-087）：作者档案、停权状态、作品卡片 / 作品页 DTO、红点同步。
 * 用户端（PlazaService）和管理端（PlazaAdminService）共用。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  MediaReadPort,
  PlazaAuthor,
  PlazaSnapshot,
  PlazaWorkCard,
  PlazaWorkDetail,
  SyncPort,
  Tx,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  newId,
  type Clock,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { MEDIA_READ_PORT } from '../../media/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { DELETED_AUTHOR_NAME } from '../domain/rules.js';
import {
  adoptions,
  authorProfiles,
  bans,
  comments,
  likes,
  notices,
  workVersions,
  works,
  type NoticeKind,
  type ProfileRow,
  type WorkRow,
} from '../infra/db/schema.js';

type Runner = Database | DbTx;

export interface BanState {
  banned: boolean;
  until: Date | 'permanent' | null;
}

@Injectable()
export class PlazaStore {
  constructor(
    @Inject(DATABASE) readonly db: Database,
    @Inject(CLOCK) readonly clock: Clock,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
  ) {}

  // ---------- 停权 ----------

  /** 作者未被停权的 SQL 条件（用于列表：被停权作者的作品全部不展示，ADM-09 第 4 条）。 */
  notBannedCond(): SQL {
    return sql`not exists (select 1 from ${bans} where ${bans.userId} = ${works.authorUserId} and (${bans.permanent} or ${bans.until} > ${this.clock.now()}))`;
  }

  /** 广场上可见：上架中且作者未被停权。 */
  visibleCond(): SQL {
    return and(eq(works.status, 'listed'), this.notBannedCond())!;
  }

  async banState(userId: string, runner: Runner = this.db): Promise<BanState> {
    const [row] = await runner.db.select().from(bans).where(eq(bans.userId, userId));
    if (!row) return { banned: false, until: null };
    if (row.permanent) return { banned: true, until: 'permanent' };
    if (row.until && row.until.getTime() > this.clock.nowMs())
      return { banned: true, until: row.until };
    return { banned: false, until: null };
  }

  async assertNotBanned(userId: string, runner: Runner = this.db): Promise<void> {
    if ((await this.banState(userId, runner)).banned)
      throw new AppError('plaza_publish_forbidden', '你已被暂停在人设广场发布和评论');
  }

  async bannedSet(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const rows = await this.db.db.select().from(bans).where(inArray(bans.userId, userIds));
    const now = this.clock.nowMs();
    return new Set(
      rows.filter((r) => r.permanent || (r.until && r.until.getTime() > now)).map((r) => r.userId),
    );
  }

  // ---------- 作者 ----------

  async profile(userId: string, runner: Runner = this.db): Promise<ProfileRow | null> {
    const [row] = await runner.db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.userId, userId));
    return row ?? null;
  }

  async profiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();
    const rows = await this.db.db
      .select()
      .from(authorProfiles)
      .where(inArray(authorProfiles.userId, ids));
    return new Map(rows.map((r) => [r.userId, r]));
  }

  /** plaza_avatar 是公开副本（ownerUserId = null），任何登录用户都能取短期链接。 */
  async avatarUrl(
    viewerId: string,
    mediaId: string | null,
    cache?: Map<string, string | null>,
  ): Promise<string | null> {
    if (!mediaId) return null;
    if (cache?.has(mediaId)) return cache.get(mediaId)!;
    let url: string | null;
    try {
      url = (await this.media.getMedia(viewerId, mediaId)).url;
    } catch {
      url = null;
    }
    cache?.set(mediaId, url);
    return url;
  }

  async authorDto(
    viewerId: string,
    fallbackId: string,
    profile: ProfileRow | undefined | null,
    cache?: Map<string, string | null>,
  ): Promise<PlazaAuthor> {
    if (!profile)
      return {
        authorId: fallbackId,
        nickname: DELETED_AUTHOR_NAME,
        avatarUrl: null,
        deleted: true,
      };
    return {
      authorId: profile.authorId,
      nickname: profile.nickname,
      avatarUrl: await this.avatarUrl(viewerId, profile.avatarMediaId, cache),
      deleted: false,
    };
  }

  // ---------- 作品 ----------

  async work(workId: string, runner: Runner = this.db): Promise<WorkRow | null> {
    const [row] = await runner.db.select().from(works).where(eq(works.id, workId));
    return row ?? null;
  }

  async lockWork(tx: DbTx, workId: string): Promise<WorkRow | null> {
    const [row] = await tx.db.select().from(works).where(eq(works.id, workId)).for('update');
    return row ?? null;
  }

  async version(workId: string, version: number, runner: Runner = this.db) {
    const [row] = await runner.db
      .select()
      .from(workVersions)
      .where(and(eq(workVersions.workId, workId), eq(workVersions.version, version)));
    return row ?? null;
  }

  async currentSnapshot(work: WorkRow, runner: Runner = this.db): Promise<PlazaSnapshot> {
    const v = await this.version(work.id, work.currentVersion, runner);
    if (!v) throw new AppError('internal_error', '作品版本缺失');
    return v.snapshot;
  }

  /** 作品对某用户是否可见：上架且作者未停权，或本人是作者。 */
  async visibleTo(work: WorkRow, viewerId: string): Promise<boolean> {
    if (work.authorUserId === viewerId) return true;
    if (work.status !== 'listed') return false;
    return !(await this.banState(work.authorUserId)).banned;
  }

  async cards(viewerId: string, rows: WorkRow[]): Promise<PlazaWorkCard[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [profileMap, liked, adopted] = await Promise.all([
      this.profiles(rows.map((r) => r.authorUserId)),
      this.db.db
        .select({ workId: likes.workId })
        .from(likes)
        .where(and(eq(likes.userId, viewerId), inArray(likes.workId, ids))),
      this.db.db
        .select({ workId: adoptions.workId })
        .from(adoptions)
        .where(and(eq(adoptions.userId, viewerId), inArray(adoptions.workId, ids))),
    ]);
    const likedSet = new Set(liked.map((l) => l.workId));
    const adoptedSet = new Set(adopted.map((a) => a.workId));
    const cache = new Map<string, string | null>();
    const out: PlazaWorkCard[] = [];
    for (const w of rows) {
      out.push({
        workId: w.id,
        kind: w.kind,
        name: w.name,
        tagline: w.tagline,
        basis: w.kind === 'custom_character' ? (w.basis ?? null) : null,
        basedOnPresetId: w.basedOnPresetId,
        basedOnPresetName: w.basedOnPresetName,
        avatarUrl: await this.avatarUrl(viewerId, w.avatarMediaId, cache),
        author: await this.authorDto(viewerId, w.id, profileMap.get(w.authorUserId), cache),
        likeCount: w.likeCount,
        adoptCount: w.adoptCount,
        commentCount: w.commentCount,
        adoptedByMe: adoptedSet.has(w.id),
        likedByMe: likedSet.has(w.id),
        currentVersion: w.currentVersion,
        publishedAt: w.publishedAt.toISOString(),
      });
    }
    return out;
  }

  async details(viewerId: string, rows: WorkRow[]): Promise<PlazaWorkDetail[]> {
    if (!rows.length) return [];
    const cards = await this.cards(viewerId, rows);
    const ids = rows.map((r) => r.id);
    const versions = await this.db.db
      .select()
      .from(workVersions)
      .where(inArray(workVersions.workId, ids))
      .orderBy(asc(workVersions.version));
    const banned = await this.bannedSet(rows.map((r) => r.authorUserId));
    const originIds = rows.map((r) => r.originWorkId).filter((x): x is string => !!x);
    const origins = originIds.length
      ? await this.db.db.select().from(works).where(inArray(works.id, originIds))
      : [];
    const originMap = new Map(origins.map((o) => [o.id, o]));
    const originProfiles = await this.profiles(origins.map((o) => o.authorUserId));
    const originBanned = await this.bannedSet(origins.map((o) => o.authorUserId));
    // 3.1（积压 ㊱）：我从这个作品添加的角色（最近一次）。
    const myAdoptions = await this.db.db
      .select({
        workId: adoptions.workId,
        characterId: adoptions.characterId,
        createdAt: adoptions.createdAt,
      })
      .from(adoptions)
      .where(and(eq(adoptions.userId, viewerId), inArray(adoptions.workId, ids)))
      .orderBy(asc(adoptions.createdAt));
    const adoptedMap = new Map(myAdoptions.map((a) => [a.workId, a.characterId]));
    return rows.map((w, i) => {
      const mine = versions.filter((v) => v.workId === w.id);
      const current = mine.find((v) => v.version === w.currentVersion);
      if (!current) throw new AppError('internal_error', '作品版本缺失');
      const origin = w.originWorkId ? originMap.get(w.originWorkId) : undefined;
      const status =
        w.status === 'listed' && banned.has(w.authorUserId) ? 'author_banned' : w.status;
      return {
        ...cards[i]!,
        status,
        settings: {
          tagline: w.tagline,
          publishNote: w.publishNote,
          allowRemix: w.allowRemix,
          commentsOpen: w.commentsOpen,
        },
        snapshot: current.snapshot,
        versions: mine.map((v) => ({
          version: v.version,
          changeNote: v.changeNote,
          createdAt: v.createdAt.toISOString(),
        })),
        remixOf: w.originWorkId
          ? {
              workId: w.originWorkId,
              name: origin?.name ?? w.originWorkName ?? '',
              authorNickname: origin
                ? (originProfiles.get(origin.authorUserId)?.nickname ?? DELETED_AUTHOR_NAME)
                : (w.originAuthorNickname ?? DELETED_AUTHOR_NAME),
              available:
                !!origin && origin.status === 'listed' && !originBanned.has(origin.authorUserId),
            }
          : null,
        isMine: w.authorUserId === viewerId,
        sourceCharacterId: w.authorUserId === viewerId ? w.sourceCharacterId : null,
        myAdoptedCharacterId: adoptedMap.get(w.id) ?? null,
        removedReason:
          w.authorUserId === viewerId && w.status === 'removed_by_admin'
            ? (w.removedReason ?? null)
            : null,
      };
    });
  }

  /** 3.1（积压 ㊱）：作者上次看过后各作品新增的点赞 + 评论数（不含作者自己的评论）。 */
  async unreadCounts(authorUserId: string, rows: WorkRow[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const w of rows) {
      const since = w.authorSeenAt ?? w.publishedAt;
      const [likeN] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(likes)
        .where(
          and(
            eq(likes.workId, w.id),
            sql`${likes.createdAt} > ${since}`,
            sql`${likes.userId} <> ${authorUserId}`,
          ),
        );
      const [commentN] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(comments)
        .where(
          and(
            eq(comments.workId, w.id),
            sql`${comments.createdAt} > ${since}`,
            sql`${comments.deletedAt} is null`,
            sql`${comments.authorUserId} <> ${authorUserId}`,
          ),
        );
      out.set(w.id, (likeN?.n ?? 0) + (commentN?.n ?? 0));
    }
    return out;
  }

  async detail(viewerId: string, row: WorkRow): Promise<PlazaWorkDetail> {
    const [d] = await this.details(viewerId, [row]);
    return d!;
  }

  // ---------- 通知与红点 ----------

  async notify(
    tx: DbTx,
    userId: string,
    kind: NoticeKind,
    workId: string | null,
    text: string,
  ): Promise<void> {
    await tx.db.insert(notices).values({
      id: newId(),
      userId,
      kind,
      workId,
      text: text.length > 300 ? `${text.slice(0, 299)}…` : text,
      createdAt: this.clock.now(),
    });
    await this.badgeChanged(tx, userId, workId);
  }

  async badgeChanged(tx: DbTx, userId: string, itemId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section: 'plaza_badge', characterId: null, itemId },
    });
  }

  /** 给某作品所有复制 / 应用过的用户刷新红点（新版本提示，PLZ-05 第 4 条）。 */
  async notifyAdopters(tx: DbTx, workId: string): Promise<void> {
    const rows = await tx.db
      .selectDistinct({ userId: adoptions.userId })
      .from(adoptions)
      .where(eq(adoptions.workId, workId));
    for (const r of rows) await this.badgeChanged(tx, r.userId, workId);
  }

  orCond(conds: Array<SQL | undefined>): SQL | undefined {
    const list = conds.filter((c): c is SQL => !!c);
    return list.length ? or(...list) : undefined;
  }
}
