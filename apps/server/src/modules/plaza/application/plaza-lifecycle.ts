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
  JOB_QUEUE,
  USER_DATA_REGISTRY,
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
  publishDrafts,
  reports,
  works,
} from '../infra/db/schema.js';
import { PlazaService } from './plaza.service.js';
import { PlazaStore } from './plaza-store.js';

export const PLAZA_DRAFT_SWEEP_JOB = 'plaza.draft_sweep';

@Injectable()
export class PlazaLifecycle implements OnModuleInit {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Inject(PlazaService) private readonly plaza: PlazaService,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(MEDIA_SYSTEM_PORT) private readonly media: MediaSystemPort,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'plaza',
      purgeUser: (userId) => this.purgeUser(userId),
      countUserData: (userId) => this.countUserData(userId),
    });
    await this.jobs.work(PLAZA_DRAFT_SWEEP_JOB, () => this.sweepDrafts());
    await this.jobs.schedule(PLAZA_DRAFT_SWEEP_JOB, '23 * * * *');
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
    ]);
    return parts.reduce((a, b) => a + b, 0);
  }
}
