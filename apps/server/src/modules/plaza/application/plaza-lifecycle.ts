/**
 * plaza 删除清单与定时清理（T-087）。
 *
 * 注销（PLZ-06 第 4 条、persona-plaza.md 第 3 节）：删除该用户的作品（连同版本、点赞、评论、举报、公开头像）、
 * 在别人作品下的评论与点赞（同步扣减计数）、举报、通知、草稿、复制关系、停权记录、广场资料；
 * **不删除**别人的复制关系和复制得到的角色；别人的改编作品里「原作者」改显示「已注销用户」。
 * 发布草稿保留 24 小时，过期由每小时的清扫删除。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, count, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { MediaSystemPort } from '@weiban/contracts';
import {
  AppError,
  CHARACTER_PURGE_REGISTRY,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type CharacterPurgeRegistry,
  type DbTx,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { DELETED_AUTHOR_NAME } from '../domain/rules.js';
import {
  adoptions,
  authorProfiles,
  bans,
  comments,
  likes,
  notices,
  officialComments,
  officialLikes,
  publishDrafts,
  reports,
  works,
} from '../infra/db/schema.js';
import { PlazaService } from './plaza.service.js';
import { PlazaStore } from './plaza-store.js';
import { RoleRequestService } from './role-requests.service.js';

export const PLAZA_DRAFT_SWEEP_JOB = 'plaza.draft_sweep';
/** 0092（Q5）：已结束但积分仍冻结的申请制作，补做扣除 / 退回。 */
export const PLAZA_ROLE_REQUEST_FEE_SWEEP_JOB = 'plaza.role_request_fee_sweep';

@Injectable()
export class PlazaLifecycle implements OnModuleInit {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(PlazaService) private readonly plaza: PlazaService,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHARACTER_PURGE_REGISTRY) private readonly purgeRegistry: CharacterPurgeRegistry,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
    @Inject(RoleRequestService) private readonly roleRequests: RoleRequestService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'plaza',
      purgeUser: (userId) => this.purgeUser(userId),
      countUserData: (userId) => this.countUserData(userId),
    });
    this.purgeRegistry.register({
      module: 'plaza',
      assertAllowed: (characterId) => this.assertCharacterPurgeAllowed(characterId),
      purge: (tx, characterId) => this.purgeCharacter(tx, characterId),
    });
    await this.jobs.work(PLAZA_DRAFT_SWEEP_JOB, () => this.sweepDrafts());
    await this.jobs.schedule(PLAZA_DRAFT_SWEEP_JOB, '23 * * * *');
    await this.jobs.work(PLAZA_ROLE_REQUEST_FEE_SWEEP_JOB, async () => {
      await this.roleRequests.sweepFees();
    });
    await this.jobs.schedule(PLAZA_ROLE_REQUEST_FEE_SWEEP_JOB, '*/10 * * * *');
  }

  /**
   * 用户已发布的「预设改版」作品脱离预设角色后无法继续应用，不静默删除用户作品：
   * 有引用时拒绝彻底删除，提示管理员先在角色广场处理。
   */
  async assertCharacterPurgeAllowed(characterId: string): Promise<void> {
    const [row] = await this.store.db.db
      .select({ n: count() })
      .from(works)
      .where(and(eq(works.kind, 'preset_variant'), eq(works.sourceCharacterId, characterId)));
    const blockingWorks = row?.n ?? 0;
    if (blockingWorks > 0)
      throw new AppError(
        'conflict',
        `还有 ${blockingWorks} 个用户发布的预设改版作品基于这个角色，彻底删除会让这些作品无法继续使用。请先在「角色广场」下架或删除这些作品，再回来彻底删除。`,
        { details: { blockingWorks } },
      );
  }

  /** 后台彻底删除角色：官方点赞 / 评论、应用记录、制作申请、发布草稿。作品由上面的检查保护。 */
  private async purgeCharacter(tx: DbTx, characterId: string): Promise<void> {
    await tx.query('DELETE FROM plaza.official_likes WHERE character_id = $1', [characterId]);
    await tx.query(
      `UPDATE plaza.official_comments
          SET reply_to_comment_id = NULL
        WHERE reply_to_comment_id IN (
          SELECT id FROM plaza.official_comments WHERE character_id = $1
        )`,
      [characterId],
    );
    await tx.query('DELETE FROM plaza.official_comments WHERE character_id = $1', [characterId]);
    await tx.query('DELETE FROM plaza.adoptions WHERE character_id = $1', [characterId]);
    await tx.query('UPDATE plaza.role_requests SET character_id = NULL WHERE character_id = $1', [
      characterId,
    ]);
    await tx.query(
      `DELETE FROM plaza.publish_drafts
        WHERE source->>'presetCharacterId' = $1 OR source->>'characterId' = $1`,
      [characterId],
    );
  }

  async sweepDrafts(): Promise<void> {
    await this.store.db.db
      .delete(publishDrafts)
      .where(lt(publishDrafts.expiresAt, this.store.clock.now()));
  }

  async purgeUser(userId: string): Promise<number> {
    const db = this.store.db;
    return db.transaction(async (tx) => {
      let n = 0;
      const mine = await tx.db.select().from(works).where(eq(works.authorUserId, userId));
      // 别人复制 / 应用过的角色保留，来源作者显示「已注销用户」（PLZ-06 第 4 条）：作品删除前在采用记录上留标记。
      if (mine.length)
        await tx.db
          .update(adoptions)
          .set({ authorDeletedAt: this.store.clock.now() })
          .where(
            and(
              inArray(
                adoptions.workId,
                mine.map((w) => w.id),
              ),
              isNull(adoptions.authorDeletedAt),
            ),
          );
      for (const w of mine) n += await this.plaza.deleteWorkTx(tx, w);
      await tx.db
        .update(works)
        .set({ originAuthorNickname: DELETED_AUTHOR_NAME, originAuthorUserId: null })
        .where(eq(works.originAuthorUserId, userId));
      // 在别人作品下的评论：扣减计数后物理删除；别人回复我的评论去掉对我的引用。
      const myComments = await tx.db
        .select({ id: comments.id, workId: comments.workId })
        .from(comments)
        .where(and(eq(comments.authorUserId, userId), isNull(comments.deletedAt)));
      for (const c of myComments)
        await tx.db
          .update(works)
          .set({ commentCount: sql`greatest(${works.commentCount} - 1, 0)` })
          .where(eq(works.id, c.workId));
      n += (
        await tx.db
          .delete(comments)
          .where(eq(comments.authorUserId, userId))
          .returning({ id: comments.id })
      ).length;
      await tx.db
        .update(comments)
        .set({ replyToUserId: null })
        .where(eq(comments.replyToUserId, userId));
      const myLikes = await tx.db
        .delete(likes)
        .where(eq(likes.userId, userId))
        .returning({ workId: likes.workId });
      for (const l of myLikes)
        await tx.db
          .update(works)
          .set({ likeCount: sql`greatest(${works.likeCount} - 1, 0)` })
          .where(eq(works.id, l.workId));
      n += myLikes.length;
      n += (
        await tx.db
          .delete(reports)
          .where(eq(reports.reporterUserId, userId))
          .returning({ id: reports.id })
      ).length;
      n += (
        await tx.db.delete(notices).where(eq(notices.userId, userId)).returning({ id: notices.id })
      ).length;
      n += (
        await tx.db
          .delete(publishDrafts)
          .where(eq(publishDrafts.userId, userId))
          .returning({ id: publishDrafts.id })
      ).length;
      n += (
        await tx.db
          .delete(adoptions)
          .where(eq(adoptions.userId, userId))
          .returning({ id: adoptions.id })
      ).length;
      n += (await tx.db.delete(bans).where(eq(bans.userId, userId)).returning({ id: bans.userId }))
        .length;
      // 3.5：官方角色下的点赞、评论（别人回复我的评论去掉对我的引用）与角色制作申请（连同参考图）。
      n += (
        await tx.db
          .delete(officialLikes)
          .where(eq(officialLikes.userId, userId))
          .returning({ id: officialLikes.characterId })
      ).length;
      n += (
        await tx.db
          .delete(officialComments)
          .where(eq(officialComments.authorUserId, userId))
          .returning({ id: officialComments.id })
      ).length;
      await tx.db
        .update(officialComments)
        .set({ replyToUserId: null })
        .where(eq(officialComments.replyToUserId, userId));
      n += await this.roleRequests.purgeUser(tx, userId);
      const profile = await tx.db
        .delete(authorProfiles)
        .where(eq(authorProfiles.userId, userId))
        .returning();
      for (const p of profile)
        if (p.avatarMediaId) await this.media.deleteObject(p.avatarMediaId, tx as never);
      n += profile.length;
      return n;
    });
  }

  async countUserData(userId: string): Promise<number> {
    const db = this.store.db.db;
    const one = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
    const parts = await Promise.all([
      one(db.select({ n: count() }).from(works).where(eq(works.authorUserId, userId))),
      one(
        db
          .select({ n: count() })
          .from(comments)
          .where(or(eq(comments.authorUserId, userId), eq(comments.replyToUserId, userId))),
      ),
      one(db.select({ n: count() }).from(likes).where(eq(likes.userId, userId))),
      one(db.select({ n: count() }).from(reports).where(eq(reports.reporterUserId, userId))),
      one(db.select({ n: count() }).from(notices).where(eq(notices.userId, userId))),
      one(db.select({ n: count() }).from(publishDrafts).where(eq(publishDrafts.userId, userId))),
      one(db.select({ n: count() }).from(adoptions).where(eq(adoptions.userId, userId))),
      one(db.select({ n: count() }).from(bans).where(eq(bans.userId, userId))),
      one(db.select({ n: count() }).from(authorProfiles).where(eq(authorProfiles.userId, userId))),
      one(db.select({ n: count() }).from(works).where(eq(works.originAuthorUserId, userId))),
      one(db.select({ n: count() }).from(officialLikes).where(eq(officialLikes.userId, userId))),
      one(
        db
          .select({ n: count() })
          .from(officialComments)
          .where(
            or(
              eq(officialComments.authorUserId, userId),
              eq(officialComments.replyToUserId, userId),
            ),
          ),
      ),
      this.roleRequests.countUserData(userId),
    ]);
    return parts.reduce((a, b) => a + b, 0);
  }
}
