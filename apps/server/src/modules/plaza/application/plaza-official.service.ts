/**
 * 3.5：角色广场「微伴角色」tab（官方预设角色，总经理 10-14 裁定 2.3；契约 PlazaOfficialEndpoints）。
 *
 * 角色本身归 characters（经 CharacterPlazaPort 的 listOfficialIds / getOfficialCards / getOfficialProfile 读取，
 * 只读已上架预设角色）；点赞、评论归 plaza（official_likes / official_comments）。
 * 评论规则与作品评论一致：先设置广场昵称、被停权不能评论、clientRequestId 幂等、只有一层回复；
 * 回复别人时给对方写一条广场通知（comment_replied），不推送。「添加」走 POST /contacts，不在这里。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  ListPlazaOfficialQuery,
  PLAZA_COMMENT_MAX_CHARS,
  type PlazaComment,
  type PlazaOfficialCard,
  type PlazaOfficialDetail,
} from '@weiban/contracts';
import { z } from 'zod';
import { AppError, newId, parseContract, type DbTx } from '../../../platform/index.js';
import { CONTACTS_CHARACTER_STATS, type ContactsCharacterStats } from '../../contacts/index.js';
import { decodeOffset, encodeOffset, orderByAddCount } from '../domain/rules.js';
import {
  authorProfiles,
  officialComments,
  officialLikes,
  type OfficialCommentRow,
} from '../infra/db/schema.js';
import { PLAZA_CHARACTERS, type PlazaCharacters } from '../tokens.js';
import { PlazaStore } from './plaza-store.js';

type CommentDto = z.infer<typeof PlazaComment>;

const PAGE = 20;

const AddCommentBody = z.object({
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(PLAZA_COMMENT_MAX_CHARS),
  replyToCommentId: z.uuid().nullable().optional(),
});

type OfficialPort = Required<
  Pick<PlazaCharacters, 'listOfficialIds' | 'getOfficialCards' | 'getOfficialProfile'>
>;

@Injectable()
export class PlazaOfficialService {
  constructor(
    @Inject(PlazaStore) private readonly store: PlazaStore,
    @Optional() @Inject(PLAZA_CHARACTERS) private readonly characters?: PlazaCharacters,
    @Optional()
    @Inject(CONTACTS_CHARACTER_STATS)
    private readonly contactStats?: ContactsCharacterStats,
  ) {}

  private get db() {
    return this.store.db;
  }

  private port(): OfficialPort {
    const c = this.characters;
    if (!c?.listOfficialIds || !c.getOfficialCards || !c.getOfficialProfile)
      throw new AppError('service_unavailable', '角色广场暂不可用');
    return {
      listOfficialIds: c.listOfficialIds.bind(c),
      getOfficialCards: c.getOfficialCards.bind(c),
      getOfficialProfile: c.getOfficialProfile.bind(c),
    };
  }

  /** 已上架的官方角色才能点赞、评论。 */
  private async assertListed(viewerId: string, characterId: string) {
    const found = await this.port().getOfficialProfile(viewerId, characterId);
    if (!found) throw new AppError('not_found', '角色不存在或已下架');
    return found;
  }

  private async stats(ids: string[]) {
    const likes = new Map<string, number>();
    const comments = new Map<string, number>();
    if (!ids.length) return { likes, comments };
    const [l, c] = await Promise.all([
      this.db.db
        .select({ id: officialLikes.characterId, n: count() })
        .from(officialLikes)
        .where(inArray(officialLikes.characterId, ids))
        .groupBy(officialLikes.characterId),
      this.db.db
        .select({ id: officialComments.characterId, n: count() })
        .from(officialComments)
        .where(and(inArray(officialComments.characterId, ids), isNull(officialComments.deletedAt)))
        .groupBy(officialComments.characterId),
    ]);
    for (const r of l) likes.set(r.id, r.n);
    for (const r of c) comments.set(r.id, r.n);
    return { likes, comments };
  }

  private async likedBy(viewerId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db.db
      .select({ id: officialLikes.characterId })
      .from(officialLikes)
      .where(and(eq(officialLikes.userId, viewerId), inArray(officialLikes.characterId, ids)));
    return new Set(rows.map((r) => r.id));
  }

  /**
   * 「添加热度」：有多少位用户把这个角色加进了通讯录（去重、未删除）。
   * 跨模块只走 contacts 的只读统计端口，不直接读 contacts 表；端口缺失时退回角色库稳定次序。
   */
  private async addCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length || !this.contactStats) return new Map();
    return this.contactStats.countContactUsers(ids);
  }

  // ---------- 浏览 ----------

  async list(viewerId: string, input: unknown) {
    const q = parseContract(ListPlazaOfficialQuery, input);
    const port = this.port();
    const ids = await port.listOfficialIds({ q: q.q, categoryId: q.categoryId });
    const { likes, comments } = await this.stats(ids);
    // 排序在整份候选集上完成再按 offset 分页：搜索、翻页口径一致，不会只重排当前一页。
    let ordered = ids;
    if (q.sort === 'added') {
      ordered = orderByAddCount(ids, await this.addCounts(ids));
    } else if (q.sort !== 'default') {
      const score = (id: string) =>
        q.sort === 'most_liked'
          ? (likes.get(id) ?? 0)
          : (likes.get(id) ?? 0) + 2 * (comments.get(id) ?? 0);
      const order = new Map(ids.map((id, i) => [id, i]));
      ordered = [...ids].sort((a, b) => score(b) - score(a) || order.get(a)! - order.get(b)!);
    }
    const offset = decodeOffset(q.cursor);
    const pageIds = ordered.slice(offset, offset + q.limit);
    const [cards, liked] = await Promise.all([
      port.getOfficialCards(viewerId, pageIds),
      this.likedBy(viewerId, pageIds),
    ]);
    const items: PlazaOfficialCard[] = cards.map((character) => ({
      character,
      likeCount: likes.get(character.characterId) ?? 0,
      commentCount: comments.get(character.characterId) ?? 0,
      likedByMe: liked.has(character.characterId),
    }));
    return {
      items,
      nextCursor: ordered.length > offset + q.limit ? encodeOffset(offset + q.limit) : null,
    };
  }

  async get(viewerId: string, characterId: string): Promise<PlazaOfficialDetail> {
    const found = await this.assertListed(viewerId, characterId);
    const [{ likes, comments }, liked] = await Promise.all([
      this.stats([characterId]),
      this.likedBy(viewerId, [characterId]),
    ]);
    return {
      character: found.profile,
      persona: found.persona,
      likeCount: likes.get(characterId) ?? 0,
      commentCount: comments.get(characterId) ?? 0,
      likedByMe: liked.has(characterId),
    };
  }

  // ---------- 点赞 ----------

  private async likeCount(characterId: string): Promise<number> {
    const [row] = await this.db.db
      .select({ n: count() })
      .from(officialLikes)
      .where(eq(officialLikes.characterId, characterId));
    return row?.n ?? 0;
  }

  async like(userId: string, characterId: string) {
    await this.assertListed(userId, characterId);
    await this.db.db
      .insert(officialLikes)
      .values({ characterId, userId, createdAt: this.store.clock.now() })
      .onConflictDoNothing();
    return { likeCount: await this.likeCount(characterId), likedByMe: true };
  }

  async unlike(userId: string, characterId: string) {
    await this.db.db
      .delete(officialLikes)
      .where(and(eq(officialLikes.characterId, characterId), eq(officialLikes.userId, userId)));
    return { likeCount: await this.likeCount(characterId), likedByMe: false };
  }

  // ---------- 评论 ----------

  async listComments(viewerId: string, characterId: string, cursor: string | undefined) {
    await this.assertListed(viewerId, characterId);
    const offset = decodeOffset(cursor);
    const rows = await this.db.db
      .select()
      .from(officialComments)
      .where(and(eq(officialComments.characterId, characterId), isNull(officialComments.deletedAt)))
      .orderBy(asc(officialComments.createdAt), asc(officialComments.id))
      .limit(PAGE + 1)
      .offset(offset);
    const page = rows.slice(0, PAGE);
    return {
      items: await this.commentDtos(viewerId, page),
      nextCursor: rows.length > PAGE ? encodeOffset(offset + PAGE) : null,
    };
  }

  private async commentDtos(viewerId: string, rows: OfficialCommentRow[]): Promise<CommentDto[]> {
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
        deletable: r.authorUserId === viewerId,
      });
    }
    return out;
  }

  async addComment(userId: string, characterId: string, input: unknown): Promise<CommentDto> {
    const body = parseContract(AddCommentBody, input);
    const profile = await this.store.profile(userId);
    if (!profile) throw new AppError('conflict', '请先设置广场昵称');
    await this.store.assertNotBanned(userId);
    const [dup] = await this.db.db
      .select()
      .from(officialComments)
      .where(
        and(
          eq(officialComments.authorUserId, userId),
          eq(officialComments.clientRequestId, body.clientRequestId),
        ),
      );
    if (dup) return (await this.commentDtos(userId, [dup]))[0]!;
    const found = await this.assertListed(userId, characterId);
    let replyTo: OfficialCommentRow | null = null;
    if (body.replyToCommentId) {
      const [r] = await this.db.db
        .select()
        .from(officialComments)
        .where(
          and(
            eq(officialComments.id, body.replyToCommentId),
            eq(officialComments.characterId, characterId),
            isNull(officialComments.deletedAt),
          ),
        );
      if (!r) throw new AppError('not_found', '要回复的评论不存在');
      replyTo = r;
    }
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx.db
        .insert(officialComments)
        .values({
          id: newId(),
          characterId,
          authorUserId: userId,
          clientRequestId: body.clientRequestId,
          replyToCommentId: replyTo?.id ?? null,
          replyToUserId: replyTo?.authorUserId ?? null,
          text: body.text,
          createdAt: this.store.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      if (created && replyTo && replyTo.authorUserId !== userId) {
        const preview = body.text.length > 40 ? `${body.text.slice(0, 40)}…` : body.text;
        await this.store.notify(
          tx,
          replyTo.authorUserId,
          'comment_replied',
          null,
          `${profile.nickname} 在「${found.profile.name}」下回复了你：${preview}`,
        );
      }
      return created ?? null;
    });
    if (row) return (await this.commentDtos(userId, [row]))[0]!;
    const [again] = await this.db.db
      .select()
      .from(officialComments)
      .where(
        and(
          eq(officialComments.authorUserId, userId),
          eq(officialComments.clientRequestId, body.clientRequestId),
        ),
      );
    if (!again) throw new AppError('internal_error', '评论未能保存');
    return (await this.commentDtos(userId, [again]))[0]!;
  }

  /** 官方角色下的评论：找不到返回 null（调用方再按作品评论处理）。只有评论者本人能删。 */
  async deleteOwnComment(userId: string, commentId: string): Promise<boolean | null> {
    const [c] = await this.db.db
      .select()
      .from(officialComments)
      .where(eq(officialComments.id, commentId));
    if (!c) return null;
    if (c.deletedAt) return true;
    if (c.authorUserId !== userId) throw new AppError('not_found', '评论不存在');
    await this.softDelete(commentId, 'commenter');
    return true;
  }

  async softDelete(commentId: string, by: 'commenter' | 'admin', tx?: DbTx): Promise<boolean> {
    const runner = tx ?? this.db;
    const done = await runner.db
      .update(officialComments)
      .set({ deletedAt: this.store.clock.now(), deletedBy: by })
      .where(and(eq(officialComments.id, commentId), isNull(officialComments.deletedAt)))
      .returning({ id: officialComments.id });
    return done.length > 0;
  }

  async findComment(commentId: string): Promise<OfficialCommentRow | null> {
    const [c] = await this.db.db
      .select()
      .from(officialComments)
      .where(eq(officialComments.id, commentId));
    return c ?? null;
  }

  // ---------- 管理端 ----------

  async adminListComments(query: { characterId?: string; cursor?: string }) {
    const limit = 50;
    let before: { at: Date; id: string } | null = null;
    if (query.cursor) {
      try {
        const raw = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
          at: string;
          id: string;
        };
        before = { at: new Date(raw.at), id: z.uuid().parse(raw.id) };
      } catch {
        throw new AppError('bad_request', '游标无效');
      }
    }
    const conds = [isNull(officialComments.deletedAt)];
    if (query.characterId) conds.push(eq(officialComments.characterId, query.characterId));
    if (before)
      conds.push(
        or(
          lt(officialComments.createdAt, before.at),
          and(
            eq(officialComments.createdAt, before.at),
            sql`${officialComments.id} < ${before.id}`,
          ),
        )!,
      );
    const rows = await this.db.db
      .select({ c: officialComments, nickname: authorProfiles.nickname })
      .from(officialComments)
      .leftJoin(authorProfiles, eq(authorProfiles.userId, officialComments.authorUserId))
      .where(and(...conds))
      .orderBy(desc(officialComments.createdAt), desc(officialComments.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        commentId: r.c.id,
        characterId: r.c.characterId,
        authorUserId: r.c.authorUserId,
        authorNickname: r.nickname ?? null,
        text: r.c.text,
        createdAt: r.c.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ at: last.c.createdAt.toISOString(), id: last.c.id }),
            ).toString('base64url')
          : null,
    };
  }
}
