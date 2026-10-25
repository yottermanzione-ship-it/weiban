/**
 * 人设广场用户端（契约 PlazaEndpoints，PLZ-01～PLZ-07），T-087。
 *
 * 发布（persona-plaza.md 5.1）：
 *   createPublishDraft：停权 / 管理员下架 / 作者下架 / everPrivatePerson / 原作品不允许改编 → 403 plaza_publish_forbidden；
 *     characters 按白名单生成快照（CharacterPlazaPort）→ plaza 用契约严格 schema 再校验 → ai-runtime 隐私检查与儿童特征重检
 *     （PlazaPublishCheckPort，扣发布者余额；无法完成 → 422 plaza_check_unavailable，绝不跳过）→ 草稿保留 24 小时。
 *   confirmPublish：未保留的片段以「▢」遮盖；真人分类不带头像；新版本分类经 policy 比较，放宽 → 422 plaza_classification_loosened；
 *     作品、版本（只增不改）、事件在同一事务。草稿只能用一次，重试返回同一作品。
 * 复制 / 应用（5.2、5.3）：以客户端 adoptionId 为幂等键，characters 同样以它为幂等键，重试不会建出两个角色。
 * 通知：点赞、评论、回复只写广场通知 + data.changed(plaza_badge)，不推送（PLZ-03 第 4 条）。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, sql } from 'drizzle-orm';
import {
  ConfirmPublishRequest,
  ListPlazaWorksQuery,
  PLAZA_COMMENT_MAX_CHARS,
  PlazaAuthorProfile,
  PlazaBadge,
  PlazaComment,
  PlazaNotice,
  PlazaPublishDraft,
  PlazaPublishSettings,
  PlazaPublishSource,
  PlazaReportReason,
  PlazaSnapshot,
  type ContactsReadPort,
  type ContactsWritePort,
  type MediaSystemPort,
  type PlazaWorkDetail,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AppError,
  OUTBOX,
  P26_CONTACT_LIMIT,
  newId,
  parseContract,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT, CONTACTS_WRITE_PORT } from '../../contacts/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import {
  DRAFT_TTL_MS,
  HOT_WEIGHTS,
  HOT_WINDOW_DAYS,
  decodeOffset,
  encodeOffset,
  escapeLike,
  maskSnapshot,
  snapshotTexts,
  toFacts,
} from '../domain/rules.js';
import {
  adoptions,
  authorProfiles,
  comments,
  likes,
  notices,
  publishDrafts,
  reports,
  workVersions,
  works,
  type CommentRow,
  type DraftSpanJson,
  type WorkRow,
} from '../infra/db/schema.js';
import {
  PLAZA_CHARACTERS,
  PLAZA_CLASSIFICATION_POLICY,
  PLAZA_PRESET_NAMES,
  PLAZA_PUBLISH_CHECK,
  PLAZA_SUPPLEMENT_READ,
  type PlazaCharacters,
  type PlazaClassificationPolicy,
  type PlazaPresetNames,
  type PlazaPublishCheck,
  type PlazaSupplementRead,
} from '../tokens.js';
import { PlazaStore } from './plaza-store.js';

type Snapshot = z.infer<typeof PlazaSnapshot>;
type DraftDto = z.infer<typeof PlazaPublishDraft>;
type CommentDto = z.infer<typeof PlazaComment>;
type NoticeDto = z.infer<typeof PlazaNotice>;
type ProfileDto = z.infer<typeof PlazaAuthorProfile>;
type BadgeDto = z.infer<typeof PlazaBadge>;

const PAGE = 20;

const AddCommentBody = z.object({
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(PLAZA_COMMENT_MAX_CHARS),
  replyToCommentId: z.uuid().nullable().optional(),
});
const ReportBody = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('work'), workId: z.uuid() }),
    z.object({ kind: z.literal('comment'), commentId: z.uuid() }),
  ]),
  reason: PlazaReportReason,
  note: z.string().max(200).nullable().optional(),
});
const ProfileBody = z.object({
  nickname: z.string().trim().min(1).max(12),
  avatarMediaId: z.uuid().nullable(),
});
const ConfirmBody = ConfirmPublishRequest.omit({ draftId: true });
const AdoptBody = z.object({ adoptionId: z.uuid() });
const ApplyBody = z.object({ adoptionId: z.uuid(), confirmReplaceSupplement: z.boolean() });
const UpdateAdoptedBody = z.object({
  decision: z.enum(['update', 'dismiss']),
  confirmOverwrite: z.boolean().default(false),
});

/** 广场昵称 / 头像可选用的来源图片用途（用户本人上传的图片）。 */
const PROFILE_AVATAR_PURPOSES = [
  'user_avatar',
  'custom_character_avatar',
  'contact_avatar',
] as const;

@Injectable()
export class PlazaService {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CONTACTS_WRITE_PORT) private readonly contactsWrite: ContactsWritePort,
    @Optional() @Inject(PLAZA_CHARACTERS) private readonly characters?: PlazaCharacters,
    @Optional() @Inject(PLAZA_SUPPLEMENT_READ) private readonly supplements?: PlazaSupplementRead,
    @Optional() @Inject(PLAZA_PRESET_NAMES) private readonly presetNames?: PlazaPresetNames,
    @Optional() @Inject(PLAZA_PUBLISH_CHECK) private readonly check?: PlazaPublishCheck,
    @Optional()
    @Inject(PLAZA_CLASSIFICATION_POLICY)
    private readonly policy?: PlazaClassificationPolicy,
  ) {}

  private get db() {
    return this.store.db;
  }
  private get clock() {
    return this.store.clock;
  }

  private chars(): PlazaCharacters {
    if (!this.characters) throw new AppError('service_unavailable', '人设广场暂不可用');
    return this.characters;
  }

  // ---------- 浏览 ----------

  async listWorks(viewerId: string, input: unknown) {
    const q = parseContract(ListPlazaWorksQuery, input);
    const offset = decodeOffset(q.cursor);
    const conds = [this.store.visibleCond()];
    if (q.kind) conds.push(eq(works.kind, q.kind));
    if (q.basis) conds.push(and(eq(works.kind, 'custom_character'), eq(works.basis, q.basis))!);
    if (q.authorId) conds.push(eq(authorProfiles.authorId, q.authorId));
    if (q.q) {
      const pat = `%${escapeLike(q.q)}%`;
      conds.push(
        this.store.orCond([
          ilike(works.name, pat),
          ilike(works.basedOnPresetName, pat),
          ilike(authorProfiles.nickname, pat),
          sql`array_to_string(${works.tags}, ' ') ilike ${pat}`,
        ])!,
      );
    }
    const since = new Date(this.clock.nowMs() - HOT_WINDOW_DAYS * 86400_000);
    const hot = sql<number>`(
      ${sql.raw(String(HOT_WEIGHTS.like))} * (select count(*) from ${likes} where ${likes.workId} = ${works.id} and ${likes.createdAt} >= ${since})
      + ${sql.raw(String(HOT_WEIGHTS.adopt))} * (select count(*) from ${adoptions} where ${adoptions.workId} = ${works.id} and ${adoptions.createdAt} >= ${since})
      + ${sql.raw(String(HOT_WEIGHTS.comment))} * (select count(*) from ${comments} where ${comments.workId} = ${works.id} and ${comments.deletedAt} is null and ${comments.createdAt} >= ${since})
    )`;
    const order =
      q.sort === 'hot'
        ? [desc(hot), desc(works.publishedAt), desc(works.id)]
        : q.sort === 'most_liked'
          ? [desc(works.likeCount), desc(works.publishedAt), desc(works.id)]
          : q.sort === 'added'
            ? // 角色广场「添加热度」：作品累计采用数（每次采用都会把角色加进通讯录）从多到少，
              // 相同按发布时间、再按 id，在 SQL 里先排完全集再分页；点赞 / 评论不参与。
              [desc(works.adoptCount), desc(works.publishedAt), desc(works.id)]
            : [desc(works.publishedAt), desc(works.id)];
    const rows = await this.db.db
      .select({ w: works })
      .from(works)
      .leftJoin(authorProfiles, eq(authorProfiles.userId, works.authorUserId))
      .where(and(...conds))
      .orderBy(...order)
      .limit(q.limit + 1)
      .offset(offset);
    const page = rows.slice(0, q.limit).map((r) => r.w);
    return {
      items: await this.store.cards(viewerId, page),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
    };
  }

  async getWork(viewerId: string, workId: string): Promise<PlazaWorkDetail> {
    const w = await this.store.work(workId);
    if (!w || !(await this.store.visibleTo(w, viewerId)))
      throw new AppError('not_found', '作品不存在或已下架');
    // 3.1（积压 ㊱）：作者打开自己的作品 → 更新已读位置（「我发布的」红点清零）。
    if (w.authorUserId === viewerId)
      await this.db.transaction(async (tx) => {
        await tx.db.update(works).set({ authorSeenAt: this.clock.now() }).where(eq(works.id, w.id));
        await this.store.badgeChanged(tx, viewerId, w.id);
      });
    return this.store.detail(viewerId, w);
  }

  async getAuthor(viewerId: string, authorId: string) {
    const [p] = await this.db.db
      .select()
      .from(authorProfiles)
      .where(eq(authorProfiles.authorId, authorId));
    if (!p) throw new AppError('not_found', '找不到该作者');
    return this.store.authorDto(viewerId, authorId, p);
  }

  async listMyWorks(userId: string) {
    const rows = await this.db.db
      .select()
      .from(works)
      .where(eq(works.authorUserId, userId))
      .orderBy(desc(works.publishedAt));
    const details = await this.store.details(userId, rows);
    const unread = await this.store.unreadCounts(userId, rows);
    return { items: details.map((d) => ({ ...d, unreadCount: unread.get(d.workId) ?? 0 })) };
  }

  // ---------- 广场昵称 ----------

  async getMyProfile(userId: string): Promise<ProfileDto | null> {
    const p = await this.store.profile(userId);
    if (!p) return null;
    return this.profileDto(userId, p);
  }

  async putMyProfile(userId: string, input: unknown): Promise<ProfileDto> {
    const body = parseContract(ProfileBody, input);
    const existing = await this.store.profile(userId);
    let avatarMediaId: string | null = existing?.avatarMediaId ?? null;
    let oldToDelete: string | null = null;
    if (body.avatarMediaId === null) {
      oldToDelete = avatarMediaId;
      avatarMediaId = null;
    } else if (body.avatarMediaId !== avatarMediaId) {
      if (!(await this.media.canUse(userId, body.avatarMediaId, [...PROFILE_AVATAR_PURPOSES])))
        throw new AppError('bad_request', '请选择自己上传的图片作为广场头像');
      const copy = await this.media.copyObject({
        mediaId: body.avatarMediaId,
        ownerUserId: null,
        purpose: 'plaza_avatar',
      });
      oldToDelete = avatarMediaId;
      avatarMediaId = copy.mediaId;
    }
    const now = this.clock.now();
    const row = await this.db.transaction(async (tx) => {
      const [saved] = await tx.db
        .insert(authorProfiles)
        .values({
          userId,
          authorId: newId(),
          nickname: body.nickname,
          avatarMediaId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: authorProfiles.userId,
          set: { nickname: body.nickname, avatarMediaId, updatedAt: now },
        })
        .returning();
      if (oldToDelete) await this.media.deleteObject(oldToDelete, tx as never);
      await this.store.badgeChanged(tx, userId, null);
      return saved!;
    });
    return this.profileDto(userId, row);
  }

  private async profileDto(
    userId: string,
    p: typeof authorProfiles.$inferSelect,
  ): Promise<ProfileDto> {
    const ban = await this.store.banState(userId);
    return {
      authorId: p.authorId,
      nickname: p.nickname,
      avatarMediaId: p.avatarMediaId,
      avatarUrl: await this.store.avatarUrl(userId, p.avatarMediaId),
      bannedUntil: ban.banned
        ? ban.until === 'permanent'
          ? 'permanent'
          : (ban.until as Date).toISOString()
        : null,
    };
  }

  // ---------- 发布 ----------

  async createPublishDraft(userId: string, input: unknown): Promise<DraftDto> {
    const { source } = parseContract(z.object({ source: PlazaPublishSource }), input);
    await this.store.assertNotBanned(userId);
    const sourceCharacterId =
      source.kind === 'custom_character' ? source.characterId : source.presetCharacterId;
    const [existing] = await this.db.db
      .select()
      .from(works)
      .where(
        and(
          eq(works.authorUserId, userId),
          eq(works.kind, source.kind),
          eq(works.sourceCharacterId, sourceCharacterId),
        ),
      );
    if (existing?.status === 'removed_by_admin')
      throw new AppError('plaza_publish_forbidden', '该作品已被管理员下架，不能发布新版本');
    if (existing?.status === 'unlisted_by_author')
      throw new AppError('plaza_publish_forbidden', '作品已下架，重新上架后才能发布新版本');

    const characters = this.chars();
    let snapshot: Snapshot;
    let originWorkId: string | null = existing?.originWorkId ?? null;
    if (source.kind === 'custom_character') {
      const built = await characters.buildPublishSnapshot(userId, source.characterId);
      if (!built.ok) {
        if (built.error === 'forbidden')
          throw new AppError(
            'plaza_publish_forbidden',
            '以身边的人为原型的角色不能发布，这是为了保护 TA 的隐私',
          );
        throw new AppError('not_found', '角色不存在');
      }
      snapshot = this.strict(built.value);
      if (snapshot.kind !== 'custom_character')
        throw new AppError('internal_error', '快照类型错误');
      // PLZ-02 第 11 条：直接调用接口同样拒绝（双重检查，不只依赖 characters）。
      if (
        snapshot.classification.everPrivatePerson ||
        snapshot.classification.realPersonKind === 'private_person'
      )
        throw new AppError(
          'plaza_publish_forbidden',
          '以身边的人为原型的角色不能发布，这是为了保护 TA 的隐私',
        );
      // PLZ-04 第 6 条：复制来的角色再发布，原作品必须允许改编。
      const origin = await characters.getPlazaOrigin(source.characterId);
      if (origin) {
        const originWork = await this.store.work(origin.workId);
        if (!originWork || !originWork.allowRemix)
          throw new AppError('plaza_publish_forbidden', '原作品不允许改编后再发布');
        originWorkId = origin.workId;
      }
    } else {
      const built = await characters.buildVariantSnapshot(userId, source.presetCharacterId);
      if (!built.ok) throw new AppError('not_found', '你还没有为这个角色写补充设定');
      snapshot = this.strict(built.value);
    }

    // 隐私检查 + 儿童特征重检（PLZ-02 第 6、7 条）：无法完成时不能发布，不跳过。
    if (!this.check)
      throw new AppError('plaza_check_unavailable', '暂时无法完成发布前检查，请稍后再试');
    const draftId = newId();
    const result = await this.check.checkBeforePublish({
      userId,
      idempotencyKey: draftId,
      source,
      texts: snapshotTexts(snapshot),
    });
    if (!result.ok) {
      if (result.error === 'bad_request') throw new AppError('bad_request', '发布内容无法检查');
      throw new AppError(
        'plaza_check_unavailable',
        result.error === 'insufficient_balance'
          ? '余额不足，暂时无法完成发布前检查'
          : '暂时无法完成发布前检查，请稍后再试',
      );
    }
    let childFeaturesDetected = result.value.childFeaturesDetected;
    if (snapshot.kind === 'custom_character') {
      childFeaturesDetected =
        childFeaturesDetected || snapshot.classification.childFeaturesDetected;
      snapshot = {
        ...snapshot,
        classification: { ...snapshot.classification, childFeaturesDetected },
        // 真人分类不带用户上传的头像（PLZ-02 第 5 条，hard-boundaries.md 第 6 节第 8 条）。
        avatarMediaId:
          snapshot.classification.basis === 'real_person' ? null : snapshot.avatarMediaId,
      };
    } else if (childFeaturesDetected) {
      // 3.1（积压 ㉝）：改版文字检出儿童特征写进快照，应用改版时 characters 取更严的一边。
      snapshot = { ...snapshot, childFeaturesDetected: true };
    }
    const spans: DraftSpanJson[] = result.value.spans.map((s, i) => ({
      spanId: `s${i + 1}`,
      fieldKey: s.fieldKey,
      start: s.start,
      end: s.end,
      kinds: s.kinds.length ? s.kinds : ['other_private'],
    }));
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + DRAFT_TTL_MS);
    await this.db.db.insert(publishDrafts).values({
      id: draftId,
      userId,
      workId: existing?.id ?? null,
      source,
      snapshot,
      spans,
      childFeaturesDetected,
      originWorkId,
      expiresAt,
      createdAt: now,
    });
    const profile = await this.store.profile(userId);
    return {
      draftId,
      workId: existing?.id ?? null,
      snapshot,
      spans: spans.map((s) => ({ ...s, kinds: s.kinds as DraftDto['spans'][number]['kinds'] })),
      childFeaturesDetected,
      needsAuthorProfile: !profile,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmPublish(userId: string, draftId: string, input: unknown): Promise<PlazaWorkDetail> {
    const body = parseContract(ConfirmBody, input);
    const settings = parseContract(PlazaPublishSettings, body.settings);
    const [draft] = await this.db.db
      .select()
      .from(publishDrafts)
      .where(and(eq(publishDrafts.id, draftId), eq(publishDrafts.userId, userId)));
    if (!draft) throw new AppError('not_found', '发布草稿不存在');
    if (draft.consumedWorkId) {
      const done = await this.store.work(draft.consumedWorkId);
      if (done) return this.store.detail(userId, done);
    }
    if (draft.expiresAt.getTime() <= this.clock.nowMs())
      throw new AppError('conflict', '发布草稿已过期，请重新点「发布」');
    const profile = await this.store.profile(userId);
    if (!profile) throw new AppError('conflict', '请先设置广场昵称');
    await this.store.assertNotBanned(userId);

    const kept = new Set(body.keptSpanIds);
    let snapshot = this.strict(
      maskSnapshot(
        draft.snapshot,
        draft.spans.filter((s) => !kept.has(s.spanId)),
      ),
    );

    // 头像：原创 / 虚构且勾选「我有权使用这张图片」才复制为广场公开副本；真人分类强制为空。
    let avatarMediaId: string | null = null;
    if (snapshot.kind === 'custom_character') {
      if (
        snapshot.avatarMediaId &&
        snapshot.classification.basis !== 'real_person' &&
        body.avatarRightsConfirmed
      ) {
        const copy = await this.media.copyObject({
          mediaId: snapshot.avatarMediaId,
          ownerUserId: null,
          purpose: 'plaza_avatar',
        });
        avatarMediaId = copy.mediaId;
      }
      snapshot = { ...snapshot, avatarMediaId };
    }

    const classification = snapshot.kind === 'custom_character' ? snapshot.classification : null;
    let presetName: string | null = null;
    if (snapshot.kind === 'preset_variant')
      presetName =
        (await this.presetNames?.getDisplayName(userId, snapshot.presetCharacterId)) ?? null;

    const origin = draft.originWorkId ? await this.store.work(draft.originWorkId) : null;
    const originProfile = origin ? await this.store.profile(origin.authorUserId) : null;
    const sourceCharacterId =
      draft.source.kind === 'custom_character'
        ? draft.source.characterId
        : draft.source.presetCharacterId;
    const now = this.clock.now();
    const derived = {
      name:
        snapshot.kind === 'custom_character'
          ? snapshot.name
          : (presetName ?? '预设改版').slice(0, 32),
      basis: classification?.basis ?? null,
      tags: snapshot.kind === 'custom_character' ? snapshot.tags : [],
      avatarMediaId,
      tagline: settings.tagline,
      publishNote: settings.publishNote,
      allowRemix: settings.allowRemix,
      commentsOpen: settings.commentsOpen,
    };

    const workId = await this.db.transaction(async (tx) => {
      const existing = draft.workId ? await this.store.lockWork(tx, draft.workId) : null;
      if (existing) {
        if (existing.authorUserId !== userId) throw new AppError('not_found', '作品不存在');
        if (existing.status !== 'listed')
          throw new AppError('plaza_publish_forbidden', '作品已下架，不能发布新版本');
        const prev = await this.store.version(existing.id, existing.currentVersion, tx);
        if (prev?.classification && classification) {
          if (!this.policy) throw new AppError('service_unavailable', '暂时无法发布新版本');
          if (
            this.policy.compareClassification(
              toFacts(prev.classification),
              toFacts(classification),
            ) === 'looser'
          )
            throw new AppError('plaza_classification_loosened', '新版本的分类不能比上一版宽');
        }
        const version = existing.currentVersion + 1;
        await tx.db.insert(workVersions).values({
          workId: existing.id,
          version,
          snapshot,
          settings,
          classification,
          changeNote: body.changeNote ?? null,
          createdAt: now,
        });
        await tx.db
          .update(works)
          .set({
            ...derived,
            basedOnPresetName: presetName,
            currentVersion: version,
            updatedAt: now,
          })
          .where(eq(works.id, existing.id));
        await this.outbox.publish(tx, 'plaza.work_version_published', 'plaza', {
          workId: existing.id,
          authorUserId: userId,
          version,
        });
        await this.store.notifyAdopters(tx, existing.id);
        await tx.db
          .update(publishDrafts)
          .set({ consumedWorkId: existing.id })
          .where(eq(publishDrafts.id, draftId));
        return existing.id;
      }
      const id = newId();
      const inserted = await tx.db
        .insert(works)
        .values({
          id,
          authorUserId: userId,
          kind: snapshot.kind,
          sourceCharacterId,
          basedOnPresetId: snapshot.kind === 'preset_variant' ? snapshot.presetCharacterId : null,
          basedOnPresetName: presetName,
          originWorkId: origin?.id ?? null,
          originWorkName: origin?.name ?? null,
          originAuthorUserId: origin?.authorUserId ?? null,
          originAuthorNickname: originProfile?.nickname ?? null,
          ...derived,
          currentVersion: 1,
          status: 'listed',
          publishedAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: works.id });
      // PLZ-02 第 9 条：同一来源已有作品（并发发布）→ 请重新生成草稿走「发布新版本」。
      if (!inserted.length) throw new AppError('conflict', '该角色已发布过，请发布新版本');
      await tx.db.insert(workVersions).values({
        workId: id,
        version: 1,
        snapshot,
        settings,
        classification,
        changeNote: null,
        createdAt: now,
      });
      await this.outbox.publish(tx, 'plaza.work_published', 'plaza', {
        workId: id,
        authorUserId: userId,
        kind: snapshot.kind,
      });
      await tx.db
        .update(publishDrafts)
        .set({ consumedWorkId: id })
        .where(eq(publishDrafts.id, draftId));
      await this.store.badgeChanged(tx, userId, id);
      return id;
    });
    const row = await this.store.work(workId);
    return this.store.detail(userId, row!);
  }

  /** 契约严格 schema 再校验一次（多一个字段即失败，persona-plaza.md 第 4 节）。 */
  private strict(snapshot: unknown): Snapshot {
    const parsed = PlazaSnapshot.safeParse(snapshot);
    if (!parsed.success) throw new AppError('internal_error', '发布快照不符合白名单');
    return parsed.data;
  }

  // ---------- 作者管理 ----------

  private async ownWork(userId: string, workId: string): Promise<WorkRow> {
    const w = await this.store.work(workId);
    if (!w || w.authorUserId !== userId) throw new AppError('not_found', '作品不存在');
    return w;
  }

  async updateWorkSettings(userId: string, workId: string, input: unknown) {
    const body = parseContract(PlazaPublishSettings.partial(), input);
    await this.ownWork(userId, workId);
    const set: Partial<typeof works.$inferInsert> = { updatedAt: this.clock.now() };
    if (body.tagline !== undefined) set.tagline = body.tagline;
    if (body.publishNote !== undefined) set.publishNote = body.publishNote;
    if (body.allowRemix !== undefined) set.allowRemix = body.allowRemix;
    if (body.commentsOpen !== undefined) set.commentsOpen = body.commentsOpen;
    await this.db.db.update(works).set(set).where(eq(works.id, workId));
    return this.store.detail(userId, (await this.store.work(workId))!);
  }

  async unlistWork(userId: string, workId: string) {
    const w = await this.ownWork(userId, workId);
    if (w.status === 'listed') {
      await this.db.transaction(async (tx) => {
        await tx.db
          .update(works)
          .set({ status: 'unlisted_by_author', updatedAt: this.clock.now() })
          .where(and(eq(works.id, workId), eq(works.status, 'listed')));
        await this.outbox.publish(tx, 'plaza.work_removed', 'plaza', {
          workId,
          authorUserId: userId,
          reason: 'author_unlisted',
        });
        await this.store.badgeChanged(tx, userId, workId);
      });
    }
    return this.store.detail(userId, (await this.store.work(workId))!);
  }

  async relistWork(userId: string, workId: string) {
    const w = await this.ownWork(userId, workId);
    if (w.status === 'removed_by_admin')
      throw new AppError('plaza_publish_forbidden', '作品已被管理员下架，不能自行重新上架');
    if (w.status === 'unlisted_by_author') {
      await this.store.assertNotBanned(userId);
      await this.db.db
        .update(works)
        .set({ status: 'listed', updatedAt: this.clock.now() })
        .where(and(eq(works.id, workId), eq(works.status, 'unlisted_by_author')));
    }
    return this.store.detail(userId, (await this.store.work(workId))!);
  }

  async deleteWork(userId: string, workId: string): Promise<void> {
    const w = await this.store.work(workId);
    if (!w) return;
    if (w.authorUserId !== userId) throw new AppError('not_found', '作品不存在');
    await this.db.transaction(async (tx) => {
      await this.deleteWorkTx(tx, w);
      await this.outbox.publish(tx, 'plaza.work_removed', 'plaza', {
        workId,
        authorUserId: userId,
        reason: 'author_deleted',
      });
      await this.store.badgeChanged(tx, userId, workId);
    });
  }

  /** 删除作品及其版本、点赞、评论、举报、公开头像（不可恢复，PLZ-06 第 2 条）；不动别人的复制关系。 */
  async deleteWorkTx(tx: DbTx, w: WorkRow): Promise<number> {
    const versions = await tx.db
      .select({ snapshot: workVersions.snapshot })
      .from(workVersions)
      .where(eq(workVersions.workId, w.id));
    const media = new Set<string>();
    if (w.avatarMediaId) media.add(w.avatarMediaId);
    for (const v of versions)
      if (v.snapshot.kind === 'custom_character' && v.snapshot.avatarMediaId)
        media.add(v.snapshot.avatarMediaId);
    const r = await tx.db
      .delete(reports)
      .where(eq(reports.workId, w.id))
      .returning({ id: reports.id });
    const d = await tx.db.delete(works).where(eq(works.id, w.id)).returning({ id: works.id });
    for (const m of media) await this.media.deleteObject(m, tx as never);
    return r.length + d.length + versions.length;
  }

  // ---------- 点赞 ----------

  async like(userId: string, workId: string) {
    const w = await this.store.work(workId);
    if (!w || !(await this.store.visibleTo(w, userId)))
      throw new AppError('not_found', '作品不存在或已下架');
    return this.db.transaction(async (tx) => {
      const inserted = await tx.db
        .insert(likes)
        .values({ workId, userId, createdAt: this.clock.now() })
        .onConflictDoNothing()
        .returning({ workId: likes.workId });
      if (inserted.length) {
        await tx.db
          .update(works)
          .set({ likeCount: sql`${works.likeCount} + 1` })
          .where(eq(works.id, workId));
        if (w.authorUserId !== userId)
          await this.store.notify(
            tx,
            w.authorUserId,
            'work_liked',
            workId,
            `有人赞了你的作品《${w.name}》`,
          );
      }
      const [row] = await tx.db
        .select({ n: works.likeCount })
        .from(works)
        .where(eq(works.id, workId));
      return { likeCount: row?.n ?? 0, likedByMe: true };
    });
  }

  async unlike(userId: string, workId: string) {
    return this.db.transaction(async (tx) => {
      const removed = await tx.db
        .delete(likes)
        .where(and(eq(likes.workId, workId), eq(likes.userId, userId)))
        .returning({ workId: likes.workId });
      if (removed.length)
        await tx.db
          .update(works)
          .set({ likeCount: sql`greatest(${works.likeCount} - 1, 0)` })
          .where(eq(works.id, workId));
      const [row] = await tx.db
        .select({ n: works.likeCount })
        .from(works)
        .where(eq(works.id, workId));
      if (!row) throw new AppError('not_found', '作品不存在');
      return { likeCount: row.n, likedByMe: false };
    });
  }

  // ---------- 评论 ----------

  async listComments(viewerId: string, workId: string, cursor: string | undefined) {
    const w = await this.store.work(workId);
    if (!w || !(await this.store.visibleTo(w, viewerId)))
      throw new AppError('not_found', '作品不存在或已下架');
    if (!w.commentsOpen) return { items: [], nextCursor: null };
    const offset = decodeOffset(cursor);
    const rows = await this.db.db
      .select()
      .from(comments)
      .where(and(eq(comments.workId, workId), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(PAGE + 1)
      .offset(offset);
    const page = rows.slice(0, PAGE);
    return {
      items: await this.commentDtos(viewerId, w, page),
      nextCursor: rows.length > PAGE ? encodeOffset(offset + PAGE) : null,
    };
  }

  private async commentDtos(
    viewerId: string,
    w: WorkRow,
    rows: CommentRow[],
  ): Promise<CommentDto[]> {
    const profiles = await this.store.profiles(
      rows.flatMap((r) => [r.authorUserId, ...(r.replyToUserId ? [r.replyToUserId] : [])]),
    );
    const cache = new Map<string, string | null>();
    const out: CommentDto[] = [];
    for (const r of rows) {
      out.push({
        commentId: r.id,
        author: await this.store.authorDto(viewerId, r.id, profiles.get(r.authorUserId), cache),
        replyTo:
          r.replyToCommentId || r.replyToUserId
            ? await this.store.authorDto(
                viewerId,
                r.replyToCommentId ?? r.id,
                r.replyToUserId ? profiles.get(r.replyToUserId) : null,
                cache,
              )
            : null,
        replyToCommentId: r.replyToCommentId,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
        deletable: r.authorUserId === viewerId || w.authorUserId === viewerId,
      });
    }
    return out;
  }

  async addComment(userId: string, workId: string, input: unknown): Promise<CommentDto> {
    const body = parseContract(AddCommentBody, input);
    const profile = await this.store.profile(userId);
    if (!profile) throw new AppError('conflict', '请先设置广场昵称');
    await this.store.assertNotBanned(userId);
    const w = await this.store.work(workId);
    if (!w || !(await this.store.visibleTo(w, userId)))
      throw new AppError('not_found', '作品不存在或已下架');
    const [dup] = await this.db.db
      .select()
      .from(comments)
      .where(
        and(eq(comments.authorUserId, userId), eq(comments.clientRequestId, body.clientRequestId)),
      );
    if (dup) return (await this.commentDtos(userId, w, [dup]))[0]!;
    if (!w.commentsOpen) throw new AppError('forbidden', '作者已关闭评论');
    let replyTo: CommentRow | null = null;
    if (body.replyToCommentId) {
      const [r] = await this.db.db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.id, body.replyToCommentId),
            eq(comments.workId, workId),
            isNull(comments.deletedAt),
          ),
        );
      if (!r) throw new AppError('not_found', '要回复的评论不存在');
      replyTo = r;
    }
    const row = await this.db.transaction(async (tx) => {
      const inserted = await tx.db
        .insert(comments)
        .values({
          id: newId(),
          workId,
          authorUserId: userId,
          clientRequestId: body.clientRequestId,
          replyToCommentId: replyTo?.id ?? null,
          replyToUserId: replyTo?.authorUserId ?? null,
          text: body.text,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      const created = inserted[0];
      if (!created) return null;
      await tx.db
        .update(works)
        .set({ commentCount: sql`${works.commentCount} + 1` })
        .where(eq(works.id, workId));
      const preview = body.text.length > 40 ? `${body.text.slice(0, 40)}…` : body.text;
      if (w.authorUserId !== userId)
        await this.store.notify(
          tx,
          w.authorUserId,
          'work_commented',
          workId,
          `${profile.nickname} 评论了你的作品《${w.name}》：${preview}`,
        );
      if (replyTo && replyTo.authorUserId !== userId && replyTo.authorUserId !== w.authorUserId)
        await this.store.notify(
          tx,
          replyTo.authorUserId,
          'comment_replied',
          workId,
          `${profile.nickname} 回复了你：${preview}`,
        );
      return created;
    });
    if (!row) {
      const [again] = await this.db.db
        .select()
        .from(comments)
        .where(
          and(
            eq(comments.authorUserId, userId),
            eq(comments.clientRequestId, body.clientRequestId),
          ),
        );
      if (!again) throw new AppError('internal_error', '评论未能保存');
      return (await this.commentDtos(userId, w, [again]))[0]!;
    }
    return (await this.commentDtos(userId, w, [row]))[0]!;
  }

  async deleteComment(userId: string, commentId: string): Promise<void> {
    const [c] = await this.db.db.select().from(comments).where(eq(comments.id, commentId));
    if (!c || c.deletedAt) return;
    const w = await this.store.work(c.workId);
    const by =
      c.authorUserId === userId ? 'commenter' : w?.authorUserId === userId ? 'work_author' : null;
    if (!by) throw new AppError('not_found', '评论不存在');
    await this.softDeleteComment(c.id, c.workId, by);
  }

  async softDeleteComment(
    commentId: string,
    workId: string,
    by: 'commenter' | 'work_author' | 'admin',
    tx?: DbTx,
  ): Promise<boolean> {
    const run = async (t: DbTx) => {
      const done = await t.db
        .update(comments)
        .set({ deletedAt: this.clock.now(), deletedBy: by })
        .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
        .returning({ id: comments.id });
      if (done.length)
        await t.db
          .update(works)
          .set({ commentCount: sql`greatest(${works.commentCount} - 1, 0)` })
          .where(eq(works.id, workId));
      return done.length > 0;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  // ---------- 举报 ----------

  async report(userId: string, input: unknown): Promise<void> {
    const body = parseContract(ReportBody, input);
    let targetId: string;
    let workId: string;
    if (body.target.kind === 'work') {
      const w = await this.store.work(body.target.workId);
      if (!w || !(await this.store.visibleTo(w, userId)))
        throw new AppError('not_found', '作品不存在或已下架');
      targetId = w.id;
      workId = w.id;
    } else {
      const [c] = await this.db.db
        .select()
        .from(comments)
        .where(and(eq(comments.id, body.target.commentId), isNull(comments.deletedAt)));
      if (!c) throw new AppError('not_found', '评论不存在');
      targetId = c.id;
      workId = c.workId;
    }
    const inserted = await this.db.db
      .insert(reports)
      .values({
        id: newId(),
        reporterUserId: userId,
        targetKind: body.target.kind,
        targetId,
        workId,
        reason: body.reason,
        note: body.note?.trim() || null,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: reports.id });
    if (!inserted.length) throw new AppError('conflict', '你已经举报过了');
  }

  // ---------- 红点与通知 ----------

  async getBadge(userId: string): Promise<BadgeDto> {
    const unseen = await this.db.db
      .select({ kind: notices.kind, n: count() })
      .from(notices)
      .where(and(eq(notices.userId, userId), eq(notices.seen, false)))
      .groupBy(notices.kind);
    let myWorksUnseen = 0;
    let reportResultsUnseen = 0;
    for (const u of unseen) {
      if (u.kind === 'report_resolved') reportResultsUnseen += u.n;
      else myWorksUnseen += u.n;
    }
    const [upd] = await this.db.db
      .select({ n: count() })
      .from(adoptions)
      .innerJoin(works, eq(works.id, adoptions.workId))
      .where(
        and(
          eq(adoptions.userId, userId),
          gt(works.currentVersion, adoptions.version),
          gt(works.currentVersion, adoptions.updateDismissedVersion),
        ),
      );
    return { myWorksUnseen, reportResultsUnseen, adoptedUpdatesAvailable: upd?.n ?? 0 };
  }

  async listNotices(userId: string, cursor: string | undefined) {
    const offset = decodeOffset(cursor);
    const rows = await this.db.db
      .select()
      .from(notices)
      .where(eq(notices.userId, userId))
      .orderBy(desc(notices.createdAt), desc(notices.id))
      .limit(PAGE + 1)
      .offset(offset);
    const page = rows.slice(0, PAGE);
    const unseenIds = page.filter((r) => !r.seen).map((r) => r.id);
    if (unseenIds.length)
      await this.db.transaction(async (tx) => {
        await tx.db.update(notices).set({ seen: true }).where(inArray(notices.id, unseenIds));
        await this.store.badgeChanged(tx, userId, null);
      });
    const items: NoticeDto[] = page.map((r) => ({
      noticeId: r.id,
      kind: r.kind,
      workId: r.workId,
      text: r.text,
      seen: r.seen,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, nextCursor: rows.length > PAGE ? encodeOffset(offset + PAGE) : null };
  }

  // ---------- 复制、应用、更新 ----------

  private async adoptableWork(userId: string, workId: string): Promise<WorkRow> {
    const w = await this.store.work(workId);
    if (!w || w.status !== 'listed' || (await this.store.banState(w.authorUserId)).banned)
      throw new AppError('not_found', '作品不存在或已下架');
    void userId;
    return w;
  }

  private async authorName(userId: string): Promise<string> {
    return (await this.store.profile(userId))?.nickname ?? '已注销用户';
  }

  private async existingAdoption(userId: string, adoptionId: string) {
    const [a] = await this.db.db.select().from(adoptions).where(eq(adoptions.id, adoptionId));
    if (a && a.userId !== userId) throw new AppError('conflict', '请求编号已被使用');
    return a ?? null;
  }

  async adopt(userId: string, workId: string, input: unknown) {
    const { adoptionId } = parseContract(AdoptBody, input);
    const done = await this.existingAdoption(userId, adoptionId);
    if (done) return { characterId: done.characterId, workVersion: done.version };
    const w = await this.adoptableWork(userId, workId);
    const characters = this.chars();
    // P-26：复制前先检查通讯录上限（添加流程本身还会再检查一次）。
    const active = await this.contacts.listActiveContacts(userId);
    if (active.length >= P26_CONTACT_LIMIT)
      throw new AppError('contact_limit_reached', '通讯录已满，请先删除一些角色');
    const snapshot = await this.store.currentSnapshot(w);
    const created = await characters.createFromSnapshot({
      userId,
      snapshot,
      origin: {
        workId: w.id,
        version: w.currentVersion,
        authorName: await this.authorName(w.authorUserId),
      },
      idempotencyKey: adoptionId,
    });
    if (!created.ok) throw new AppError('character_not_available', '该作品基于的预设角色已不可用');
    // 走 CHR-03 添加流程（ContactsWritePort，「通过了你的好友申请」→ 第一条消息）；失败可用同一 adoptionId 重试。
    await this.addContact(userId, created.value.characterId, adoptionId);
    return this.recordAdoption(userId, adoptionId, w, 'copy', created.value.characterId);
  }

  async apply(userId: string, workId: string, input: unknown) {
    const body = parseContract(ApplyBody, input);
    const done = await this.existingAdoption(userId, body.adoptionId);
    if (done) return { characterId: done.characterId, workVersion: done.version };
    const w = await this.adoptableWork(userId, workId);
    if (w.kind !== 'preset_variant') throw new AppError('bad_request', '只有预设改版可以应用');
    const snapshot = await this.store.currentSnapshot(w);
    if (snapshot.kind !== 'preset_variant') throw new AppError('internal_error', '快照类型错误');
    if (!body.confirmReplaceSupplement && this.supplements) {
      const current = await this.supplements.getSupplement(userId, snapshot.presetCharacterId);
      if (current && current.trim())
        throw new AppError('conflict', '将替换你现有的补充设定，请确认');
    }
    const r = await this.chars().applyVariant({
      childFeaturesDetected: snapshot.childFeaturesDetected === true,
      userId,
      presetCharacterId: snapshot.presetCharacterId,
      variantText: snapshot.variantText,
      origin: {
        workId: w.id,
        version: w.currentVersion,
        authorName: await this.authorName(w.authorUserId),
      },
      idempotencyKey: body.adoptionId,
    });
    if (!r.ok) throw new AppError('character_not_available', '该预设角色已不可用');
    // 未添加该预设角色时先添加（PLZ-04 第 3 条）。
    if (!(await this.contacts.getActiveContact(userId, snapshot.presetCharacterId)))
      await this.addContact(userId, snapshot.presetCharacterId, body.adoptionId);
    return this.recordAdoption(userId, body.adoptionId, w, 'apply', snapshot.presetCharacterId);
  }

  private async addContact(userId: string, characterId: string, idempotencyKey: string) {
    const added = await this.contactsWrite.addForUser({ userId, characterId, idempotencyKey });
    if (!added.ok) {
      if (added.error === 'contact_limit_reached')
        throw new AppError('contact_limit_reached', '通讯录已满，请先删除一些角色');
      if (added.error === 'unauthenticated') throw new AppError('unauthenticated', '账号已失效');
      throw new AppError('character_not_available', '该角色暂不能添加');
    }
  }

  private async recordAdoption(
    userId: string,
    adoptionId: string,
    w: WorkRow,
    kind: 'copy' | 'apply',
    characterId: string,
  ) {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const inserted = await tx.db
        .insert(adoptions)
        .values({
          id: adoptionId,
          userId,
          workId: w.id,
          version: w.currentVersion,
          kind,
          characterId,
          updateDismissedVersion: w.currentVersion,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: adoptions.id });
      if (inserted.length) {
        await tx.db
          .update(works)
          .set({ adoptCount: sql`${works.adoptCount} + 1` })
          .where(eq(works.id, w.id));
        await this.store.badgeChanged(tx, userId, w.id);
      }
    });
    const [a] = await this.db.db.select().from(adoptions).where(eq(adoptions.id, adoptionId));
    return {
      characterId: a?.characterId ?? characterId,
      workVersion: a?.version ?? w.currentVersion,
    };
  }

  /** 来源标注所需的广场状态（characters 的 CHARACTER_PLAZA_ORIGIN_STATUS，由装配入口绑定，T-088）。 */
  async originStatus(userId: string, characterId: string, workId: string) {
    const w = await this.store.work(workId);
    const profile = w ? await this.store.profile(w.authorUserId) : null;
    const [a] = await this.db.db
      .select()
      .from(adoptions)
      .where(
        and(
          eq(adoptions.userId, userId),
          eq(adoptions.characterId, characterId),
          eq(adoptions.workId, workId),
        ),
      )
      .orderBy(desc(adoptions.updatedAt))
      .limit(1);
    const available =
      !!w && w.status === 'listed' && !(await this.store.banState(w.authorUserId)).banned;
    const newer =
      w && a && w.currentVersion > a.version && w.currentVersion > a.updateDismissedVersion
        ? w.currentVersion
        : null;
    return {
      workAvailable: available,
      authorDeleted: (!!w && !profile) || (!w && !!a?.authorDeletedAt),
      authorName: profile?.nickname ?? null,
      newerVersionAvailable: newer,
    };
  }

  async updateAdopted(userId: string, characterId: string, input: unknown) {
    const body = parseContract(UpdateAdoptedBody, input);
    const [a] = await this.db.db
      .select()
      .from(adoptions)
      .where(and(eq(adoptions.userId, userId), eq(adoptions.characterId, characterId)))
      .orderBy(desc(adoptions.updatedAt))
      .limit(1);
    if (!a) throw new AppError('not_found', '这个角色不是从人设广场添加的');
    const w = await this.store.work(a.workId);
    if (!w) throw new AppError('not_found', '原作品已删除');
    const now = this.clock.now();
    if (body.decision === 'dismiss') {
      await this.db.transaction(async (tx) => {
        await tx.db
          .update(adoptions)
          .set({ updateDismissedVersion: w.currentVersion, updatedAt: now })
          .where(eq(adoptions.id, a.id));
        await this.store.badgeChanged(tx, userId, w.id);
      });
      return { characterId, workVersion: a.version };
    }
    if (a.version >= w.currentVersion) return { characterId, workVersion: a.version };
    const characters = this.chars();
    const [adopted, latest] = await Promise.all([
      this.store.version(w.id, a.version),
      this.store.version(w.id, w.currentVersion),
    ]);
    if (!latest) throw new AppError('internal_error', '作品版本缺失');
    if (a.kind === 'copy') {
      // 用户改过人设类字段时先提示会被覆盖（PLZ-05 第 4 条）：比较当前角色快照与当初复制的版本。
      if (!body.confirmOverwrite && adopted?.snapshot.kind === 'custom_character') {
        const current = await characters.buildPublishSnapshot(userId, characterId);
        if (current.ok && this.personaChanged(current.value, adopted.snapshot))
          throw new AppError('conflict', '你对 TA 的修改会被覆盖，请确认');
      }
      const r = await characters.updateFromSnapshot({
        userId,
        characterId,
        snapshot: latest.snapshot,
        version: w.currentVersion,
      });
      if (!r.ok) {
        if (r.error === 'classification_loosened')
          throw new AppError('plaza_classification_loosened', '新版本的分类不能比现在宽');
        throw new AppError('not_found', '角色不存在');
      }
    } else {
      if (latest.snapshot.kind !== 'preset_variant')
        throw new AppError('internal_error', '快照类型错误');
      if (
        !body.confirmOverwrite &&
        this.supplements &&
        adopted?.snapshot.kind === 'preset_variant'
      ) {
        const current = await this.supplements.getSupplement(userId, characterId);
        if (current !== null && current.trim() !== adopted.snapshot.variantText.trim())
          throw new AppError('conflict', '你对补充设定的修改会被覆盖，请确认');
      }
      const r = await characters.applyVariant({
        childFeaturesDetected: latest.snapshot.childFeaturesDetected === true,
        userId,
        presetCharacterId: latest.snapshot.presetCharacterId,
        variantText: latest.snapshot.variantText,
        origin: {
          workId: w.id,
          version: w.currentVersion,
          authorName: await this.authorName(w.authorUserId),
        },
        idempotencyKey: `${a.id}:${w.currentVersion}`,
      });
      if (!r.ok) throw new AppError('not_found', '角色不存在');
    }
    await this.db.transaction(async (tx) => {
      await tx.db
        .update(adoptions)
        .set({
          version: w.currentVersion,
          updateDismissedVersion: w.currentVersion,
          updatedAt: now,
        })
        .where(eq(adoptions.id, a.id));
      await this.store.badgeChanged(tx, userId, w.id);
    });
    return { characterId, workVersion: w.currentVersion };
  }

  private personaChanged(a: Snapshot, b: Snapshot): boolean {
    if (a.kind !== 'custom_character' || b.kind !== 'custom_character') return false;
    const pick = (s: typeof a) =>
      JSON.stringify([
        s.name,
        s.description,
        s.speechStyle,
        s.catchphrases,
        s.exampleDialogue,
        s.tags,
        s.birthday,
        s.voiceName,
      ]);
    return pick(a) !== pick(b);
  }
}
