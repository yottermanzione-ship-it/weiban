/**
 * moments 模块（SOC-07～SOC-09，T-064）。
 * - 每个用户一个朋友圈世界（owner_user_id）；用户只看到自己和通讯录中 active 角色的动态、点赞、评论（读时过滤，
 *   所以删除角色后其动态消失，30 天内恢复好友后又会出现，CHR-06）。
 * - 用户动态「部分可见」时，不可见的角色经端口拿不到这条动态、不能点赞评论（SOC-09 第 2 条）。
 * - 一条动态下角色评论连续超过 6 条后拒绝，用户评论后重新计数（SOC-08 第 5 条）。
 * - 角色内容由 ai-runtime 经 MomentsCharacterPort 写入；来源只能是日常事件 / 公开动态 / 节日 / 宠物，
 *   不接受聊天消息作为来源，所以不会带入成人模式或「健康」标记的内容（SOC-07 第 8 条、MODE-05）。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  CreateMomentsPostRequest,
  Id,
  MomentsBadge,
  MomentsNotification,
  MomentsPost,
  type ContactsReadPort,
  type MediaReadPort,
  type MomentsActor,
  type MomentsCharacterPort,
  type MomentsComment,
  type MomentsLinkInput,
  type MomentsReadPort,
  type PortResult,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  OUTBOX,
  USER_DATA_REGISTRY,
  asDbTx,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { MEDIA_READ_PORT } from '../../media/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import {
  badgeState,
  comments,
  likes,
  postMedia,
  posts,
  visibility,
  type StoredLink,
} from '../infra/db/schema.js';

type PostRow = typeof posts.$inferSelect;
type CommentRow = typeof comments.$inferSelect;
type Runner = Database['db'];

/** SOC-08 第 5 条：一条朋友圈下角色评论数不超过 6 条，用户参与后可继续。 */
export const MOMENTS_CHARACTER_COMMENT_LIMIT = 6;
const KEY = /^[A-Za-z0-9:_-]{1,200}$/;

const encodeCursor = (row: PostRow) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(at ?? '');
  if (!id || Number.isNaN(date.getTime()) || !Id.safeParse(id).success)
    throw new AppError('bad_request', '分页游标不正确');
  return { at: date, id };
}

@Injectable()
export class MomentsService implements MomentsReadPort, MomentsCharacterPort, OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      module: 'moments',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
  }

  // ---------- 用户：读 ----------

  async listFeed(userId: string, query: { cursor?: string; limit: number }) {
    const active = await this.activeIds(userId);
    return this.page(userId, active, query, this.feedFilter(userId, active));
  }
  async listCharacterPostsForUser(
    userId: string,
    characterId: string,
    query: { cursor?: string; limit: number },
  ) {
    parseContract(Id, characterId);
    const active = await this.activeIds(userId);
    if (!active.has(characterId)) return { items: [], nextCursor: null };
    return this.page(
      userId,
      active,
      query,
      and(
        eq(posts.ownerUserId, userId),
        eq(posts.authorKind, 'character'),
        eq(posts.authorCharacterId, characterId),
      )!,
    );
  }
  async listMyPosts(userId: string, query: { cursor?: string; limit: number }) {
    const active = await this.activeIds(userId);
    return this.page(
      userId,
      active,
      query,
      and(eq(posts.ownerUserId, userId), eq(posts.authorKind, 'user'))!,
    );
  }
  async getPostForUser(userId: string, postId: string): Promise<MomentsPost> {
    const active = await this.activeIds(userId);
    const row = await this.visiblePostForUser(this.db.db, userId, postId, active);
    return (await this.build(this.db.db, userId, [row], active))[0]!;
  }
  async getBadge(userId: string): Promise<MomentsBadge> {
    return this.badge(this.db.db, userId, await this.activeIds(userId));
  }

  // ---------- 用户：写 ----------

  async createUserPost(userId: string, input: unknown): Promise<MomentsPost> {
    const body = parseContract(CreateMomentsPostRequest, input);
    const imageIds = [...new Set(body.imageMediaIds)];
    const active = await this.activeIds(userId);
    const images: Array<{ mediaId: string; width: number | null; height: number | null }> = [];
    for (const mediaId of imageIds) {
      const media = await this.media.getMedia(userId, mediaId);
      if (media.purpose !== 'moments_image')
        throw new AppError('bad_request', '图片用途不正确，请先按朋友圈图片上传');
      images.push({ mediaId, width: media.width, height: media.height });
    }
    const selected =
      body.visibility.kind === 'selected' ? [...new Set(body.visibility.characterIds)] : [];
    for (const id of selected)
      if (!active.has(id)) throw new AppError('bad_request', '只能选择通讯录中的角色');
    const createKey = `user:${body.clientRequestId}`;
    const postId = await this.db.transaction(async (tx) => {
      const existing = await this.findByKey(tx.db, userId, createKey);
      if (existing) return existing.id;
      const id = newId();
      const at = this.clock.now();
      const inserted = await tx.db
        .insert(posts)
        .values({
          id,
          ownerUserId: userId,
          authorKind: 'user',
          authorCharacterId: null,
          textCiphertext: await this.seal(userId, `moments:post:${id}`, body.text, tx),
          link: null,
          visibilityKind: body.visibility.kind,
          sourceKind: null,
          sourceId: null,
          createKey,
          createdAt: at,
        })
        .onConflictDoNothing()
        .returning({ id: posts.id });
      if (!inserted.length) return (await this.findByKey(tx.db, userId, createKey))!.id;
      if (images.length)
        await tx.db
          .insert(postMedia)
          .values(images.map((image, position) => ({ postId: id, position, ...image })));
      if (selected.length)
        await tx.db
          .insert(visibility)
          .values(selected.map((characterId) => ({ postId: id, characterId })));
      await this.outbox.publish(tx, 'moments.post_created', 'moments', {
        postId: id,
        ownerUserId: userId,
        authorKind: 'user',
        authorCharacterId: null,
        hasImages: images.length > 0,
        visibleCharacterIds: body.visibility.kind === 'selected' ? selected : [...active],
      });
      await this.postChanged(tx, userId, id, false);
      return id;
    });
    return this.getPostForUser(userId, postId);
  }
  async deleteUserPost(userId: string, postId: string): Promise<void> {
    parseContract(Id, postId);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .select()
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.ownerUserId, userId)));
      if (!row) return;
      if (row.authorKind !== 'user') throw new AppError('forbidden', '只能删除自己的动态');
      await tx.db.delete(posts).where(eq(posts.id, row.id));
      await this.postChanged(tx, userId, row.id, true);
      await this.pushBadge(tx, userId);
    });
  }
  async likeAsUser(userId: string, postId: string): Promise<MomentsPost> {
    const active = await this.activeIds(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.visiblePostForUser(tx.db, userId, postId, active);
      const added = await tx.db
        .insert(likes)
        .values({
          postId: row.id,
          actorKind: 'user',
          actorRefId: userId,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ postId: likes.postId });
      if (!added.length) return;
      await this.outbox.publish(tx, 'moments.post_liked', 'moments', {
        postId: row.id,
        ownerUserId: userId,
        postAuthorKind: row.authorKind as 'user' | 'character',
        likerKind: 'user',
        likerCharacterId: null,
        characterLikeCount: await this.characterLikeCount(tx.db, row.id),
      });
      await this.postChanged(tx, userId, row.id, false);
    });
    return this.getPostForUser(userId, postId);
  }
  async unlikeAsUser(userId: string, postId: string): Promise<MomentsPost> {
    const active = await this.activeIds(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.visiblePostForUser(tx.db, userId, postId, active);
      const removed = await tx.db
        .delete(likes)
        .where(
          and(eq(likes.postId, row.id), eq(likes.actorKind, 'user'), eq(likes.actorRefId, userId)),
        )
        .returning({ postId: likes.postId });
      if (removed.length) await this.postChanged(tx, userId, row.id, false);
    });
    return this.getPostForUser(userId, postId);
  }
  async commentAsUser(
    userId: string,
    postId: string,
    input: { clientRequestId: string; text: string; replyToCommentId?: string | null },
  ): Promise<MomentsPost> {
    const active = await this.activeIds(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.visiblePostForUser(tx.db, userId, postId, active);
      const reply = input.replyToCommentId
        ? await this.replyTarget(tx.db, row.id, input.replyToCommentId)
        : null;
      if (reply && reply.authorKind === 'character' && !active.has(reply.authorRefId))
        throw new AppError('not_found', '评论不存在');
      await this.insertComment(tx, row, {
        authorKind: 'user',
        authorRefId: userId,
        reply,
        text: input.text,
        mentionsUser: false,
        createKey: `user:${input.clientRequestId}`,
      });
    });
    return this.getPostForUser(userId, postId);
  }
  async deleteUserComment(userId: string, postId: string, commentId: string): Promise<MomentsPost> {
    parseContract(Id, commentId);
    const active = await this.activeIds(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.visiblePostForUser(tx.db, userId, postId, active);
      const removed = await tx.db
        .delete(comments)
        .where(
          and(
            eq(comments.id, commentId),
            eq(comments.postId, row.id),
            eq(comments.authorKind, 'user'),
            eq(comments.authorRefId, userId),
          ),
        )
        .returning({ id: comments.id });
      if (removed.length) await this.postChanged(tx, userId, row.id, false);
    });
    return this.getPostForUser(userId, postId);
  }
  /** 朋友圈消息列表（3.0.1）：通讯录中角色给我的动态点赞评论、回复我、@ 我。 */
  async listNotifications(
    userId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ items: MomentsNotification[]; nextCursor: string | null }> {
    const active = [...(await this.activeIds(userId))];
    if (!active.length) return { items: [], nextCursor: null };
    const limit = Math.min(Math.max(query.limit, 1), 50);
    let before: Date | null = null;
    let beforeId = '';
    if (query.cursor) {
      const [at, id] = Buffer.from(query.cursor, 'base64url').toString('utf8').split('|');
      before = new Date(at ?? '');
      beforeId = id ?? '';
      if (Number.isNaN(before.getTime())) throw new AppError('bad_request', '分页游标不正确');
    }
    const likeRows = await this.db.db
      .select({ like: likes, post: posts })
      .from(likes)
      .innerJoin(posts, eq(posts.id, likes.postId))
      .where(
        and(
          eq(posts.ownerUserId, userId),
          eq(posts.authorKind, 'user'),
          eq(likes.actorKind, 'character'),
          inArray(likes.actorRefId, active),
          before ? sql`${likes.createdAt} <= ${before}` : undefined,
        ),
      )
      .orderBy(desc(likes.createdAt))
      .limit(limit + 1);
    const commentRows = await this.db.db
      .select({ comment: comments, post: posts })
      .from(comments)
      .innerJoin(posts, eq(posts.id, comments.postId))
      .where(
        and(
          eq(posts.ownerUserId, userId),
          eq(comments.authorKind, 'character'),
          inArray(comments.authorRefId, active),
          or(
            eq(posts.authorKind, 'user'),
            eq(comments.replyToKind, 'user'),
            eq(comments.mentionsUser, true),
          ),
          before ? sql`${comments.createdAt} <= ${before}` : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit + 1);
    type Entry = { id: string; at: Date; build: () => Promise<MomentsNotification> };
    const preview = async (post: typeof posts.$inferSelect) => {
      const [image] = await this.db.db
        .select({ mediaId: postMedia.mediaId })
        .from(postMedia)
        .where(eq(postMedia.postId, post.id))
        .orderBy(asc(postMedia.position))
        .limit(1);
      const text = await this.open(
        post.ownerUserId,
        `moments:post:${post.id}`,
        post.textCiphertext,
      );
      return {
        author:
          post.authorKind === 'user'
            ? { kind: 'user' as const, refId: post.ownerUserId }
            : { kind: 'character' as const, refId: post.authorCharacterId! },
        text: text.slice(0, 100),
        imageMediaId: image?.mediaId ?? null,
      };
    };
    const entries: Entry[] = [
      ...likeRows.map(({ like, post }) => ({
        id: `like:${post.id}:${like.actorRefId}`,
        at: like.createdAt,
        build: async () =>
          MomentsNotification.parse({
            notificationId: `like:${post.id}:${like.actorRefId}`,
            kind: 'like',
            postId: post.id,
            commentId: null,
            actor: { kind: 'character', refId: like.actorRefId },
            text: null,
            post: await preview(post),
            createdAt: like.createdAt.toISOString(),
          }),
      })),
      ...commentRows.map(({ comment, post }) => ({
        id: `comment:${comment.id}`,
        at: comment.createdAt,
        build: async () =>
          MomentsNotification.parse({
            notificationId: `comment:${comment.id}`,
            kind: comment.mentionsUser
              ? 'mention'
              : comment.replyToKind === 'user'
                ? 'reply'
                : 'comment',
            postId: post.id,
            commentId: comment.id,
            actor: { kind: 'character', refId: comment.authorRefId },
            text: await this.open(
              post.ownerUserId,
              `moments:comment:${comment.id}`,
              comment.textCiphertext,
            ),
            post: await preview(post),
            createdAt: comment.createdAt.toISOString(),
          }),
      })),
    ]
      .filter(
        (e) =>
          !before ||
          e.at.getTime() < before.getTime() ||
          (e.at.getTime() === before.getTime() && e.id < beforeId),
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));
    const page = entries.slice(0, limit);
    const items: MomentsNotification[] = [];
    for (const entry of page) items.push(await entry.build());
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        entries.length > limit && last
          ? Buffer.from(`${last.at.toISOString()}|${last.id}`, 'utf8').toString('base64url')
          : null,
    };
  }
  async markSeen(userId: string, scope: 'posts' | 'interactions' | 'all'): Promise<MomentsBadge> {
    const active = await this.activeIds(userId);
    return this.db.transaction(async (tx) => {
      const at = this.clock.now();
      const set = {
        ...(scope !== 'interactions' ? { postsSeenAt: at } : {}),
        ...(scope !== 'posts' ? { interactionsSeenAt: at } : {}),
      };
      await tx.db
        .insert(badgeState)
        .values({ userId, postsSeenAt: at, interactionsSeenAt: at })
        .onConflictDoUpdate({ target: badgeState.userId, set });
      const badge = await this.badge(tx.db, userId, active);
      await this.sync.appendUpdate(tx, userId, { type: 'moments.badge_updated', data: { badge } });
      return badge;
    });
  }

  // ---------- MomentsReadPort ----------

  async getPostVisibleToCharacter(
    ownerUserId: string,
    postId: string,
    characterId: string,
  ): Promise<MomentsPost | null> {
    parseContract(Id, ownerUserId);
    parseContract(Id, characterId);
    return this.db.transaction(async (tx) => {
      const check = await this.characterAccess(tx, ownerUserId, postId, characterId);
      if (!check.ok) return null;
      const active = await this.activeIds(ownerUserId);
      return (await this.build(tx.db, ownerUserId, [check.row], active))[0] ?? null;
    });
  }

  async getPost(ownerUserId: string, postId: string): Promise<MomentsPost | null> {
    parseContract(Id, ownerUserId);
    if (!Id.safeParse(postId).success) return null;
    const active = await this.activeIds(ownerUserId);
    const [row] = await this.db.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.ownerUserId, ownerUserId)));
    if (!row) return null;
    return (await this.build(this.db.db, ownerUserId, [row], active))[0]!;
  }
  /** 端口：角色最近的动态（P-16「今天是否已发」用 since = 当天零点）。 */
  async listCharacterPosts(
    ownerUserId: string,
    characterId: string,
    since: string,
  ): Promise<MomentsPost[]> {
    parseContract(Id, ownerUserId);
    parseContract(Id, characterId);
    const from = new Date(since);
    if (Number.isNaN(from.getTime())) throw new AppError('bad_request', '时间不正确');
    const active = await this.activeIds(ownerUserId);
    const rows = await this.db.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.ownerUserId, ownerUserId),
          eq(posts.authorKind, 'character'),
          eq(posts.authorCharacterId, characterId),
          gt(posts.createdAt, from),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    return this.build(this.db.db, ownerUserId, rows, active);
  }
  async listUserPostsVisibleTo(
    ownerUserId: string,
    characterId: string,
    since: string,
  ): Promise<MomentsPost[]> {
    parseContract(Id, ownerUserId);
    parseContract(Id, characterId);
    const from = new Date(since);
    if (Number.isNaN(from.getTime())) throw new AppError('bad_request', '时间不正确');
    const active = await this.activeIds(ownerUserId);
    if (!active.has(characterId)) return [];
    const rows = await this.db.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.ownerUserId, ownerUserId),
          eq(posts.authorKind, 'user'),
          gt(posts.createdAt, from),
          or(
            eq(posts.visibilityKind, 'all_characters'),
            sql`EXISTS (SELECT 1 FROM moments.visibility v WHERE v.post_id = ${posts.id} AND v.character_id = ${characterId})`,
          ),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(100);
    return this.build(this.db.db, ownerUserId, rows, active);
  }

  // ---------- MomentsCharacterPort ----------

  async createPost(
    transaction: Tx | null,
    input: Parameters<MomentsCharacterPort['createPost']>[1],
  ): Promise<PortResult<MomentsPost, 'character_not_in_contacts'>> {
    parseContract(Id, input.ownerUserId);
    parseContract(Id, input.characterId);
    if (!KEY.test(input.idempotencyKey)) throw new AppError('bad_request', '幂等键不正确');
    if (!['daily_event', 'public_update', 'holiday', 'pet'].includes(input.sourceRef.kind))
      throw new AppError('bad_request', '朋友圈来源不正确');
    const text = String(input.text ?? '').slice(0, 2000);
    const imageIds = [...new Set(input.imageMediaIds.map((m) => parseContract(Id, m)))].slice(0, 9);
    if (!text.trim() && !imageIds.length) throw new AppError('bad_request', '文字和图片不能都为空');
    const createKey = `character:${input.characterId}:${input.idempotencyKey}`;
    const run = async (tx: DbTx) => {
      if (
        !(await this.contacts.getActiveContact(
          input.ownerUserId,
          input.characterId,
          tx as unknown as Tx,
        ))
      )
        return {
          ok: false as const,
          error: 'character_not_in_contacts' as const,
          message: '角色不在通讯录中',
        };
      const existing = await this.findByKey(tx.db, input.ownerUserId, createKey);
      if (existing) return { ok: true as const, id: existing.id };
      const id = newId();
      await tx.db.insert(posts).values({
        id,
        ownerUserId: input.ownerUserId,
        authorKind: 'character',
        authorCharacterId: input.characterId,
        textCiphertext: await this.seal(input.ownerUserId, `moments:post:${id}`, text, tx),
        link: input.link ? toStoredLink(input.link) : null,
        visibilityKind: null,
        sourceKind: input.sourceRef.kind,
        sourceId: String(input.sourceRef.id).slice(0, 100),
        createKey,
        createdAt: this.clock.now(),
      });
      if (imageIds.length)
        await tx.db.insert(postMedia).values(
          imageIds.map((mediaId, position) => ({
            postId: id,
            position,
            mediaId,
            width: null,
            height: null,
          })),
        );
      await this.outbox.publish(tx, 'moments.post_created', 'moments', {
        postId: id,
        ownerUserId: input.ownerUserId,
        authorKind: 'character',
        authorCharacterId: input.characterId,
        hasImages: imageIds.length > 0,
        visibleCharacterIds: [],
      });
      await this.postChanged(tx, input.ownerUserId, id, false);
      await this.pushBadge(tx, input.ownerUserId);
      return { ok: true as const, id };
    };
    const result = transaction ? await run(asDbTx(transaction)) : await this.db.transaction(run);
    if (!result.ok) return result;
    const post = await this.getPost(input.ownerUserId, result.id);
    if (!post) throw new AppError('internal_error', '动态未能保存');
    return { ok: true, value: post };
  }
  async like(
    input: Parameters<MomentsCharacterPort['like']>[0],
  ): Promise<PortResult<void, 'not_found' | 'not_visible'>> {
    parseContract(Id, input.ownerUserId);
    parseContract(Id, input.characterId);
    return this.db.transaction(async (tx) => {
      const check = await this.characterAccess(
        tx,
        input.ownerUserId,
        input.postId,
        input.characterId,
      );
      if (!check.ok) return check;
      const row = check.row;
      const added = await tx.db
        .insert(likes)
        .values({
          postId: row.id,
          actorKind: 'character',
          actorRefId: input.characterId,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ postId: likes.postId });
      if (added.length) {
        await this.outbox.publish(tx, 'moments.post_liked', 'moments', {
          postId: row.id,
          ownerUserId: input.ownerUserId,
          postAuthorKind: row.authorKind as 'user' | 'character',
          likerKind: 'character',
          likerCharacterId: input.characterId,
          characterLikeCount: await this.characterLikeCount(tx.db, row.id),
        });
        await this.postChanged(tx, input.ownerUserId, row.id, false);
        if (row.authorKind === 'user') await this.pushBadge(tx, input.ownerUserId);
      }
      return { ok: true, value: undefined };
    });
  }
  async comment(
    input: Parameters<MomentsCharacterPort['comment']>[0],
  ): Promise<PortResult<{ commentId: string }, 'not_found' | 'not_visible' | 'comment_limit'>> {
    parseContract(Id, input.ownerUserId);
    parseContract(Id, input.characterId);
    if (!KEY.test(input.idempotencyKey)) throw new AppError('bad_request', '幂等键不正确');
    const text = String(input.text ?? '').trim();
    if (!text || text.length > 500) throw new AppError('bad_request', '评论为 1～500 字');
    return this.db.transaction(async (tx) => {
      const check = await this.characterAccess(
        tx,
        input.ownerUserId,
        input.postId,
        input.characterId,
      );
      if (!check.ok) return check;
      const row = check.row;
      const [existing] = await tx.db
        .select({ id: comments.id })
        .from(comments)
        .where(
          and(
            eq(comments.postId, row.id),
            eq(comments.authorKind, 'character'),
            eq(comments.authorRefId, input.characterId),
            eq(comments.createKey, input.idempotencyKey),
          ),
        );
      if (existing) return { ok: true, value: { commentId: existing.id } };
      if ((await this.characterCommentsSinceUser(tx.db, row.id)) >= MOMENTS_CHARACTER_COMMENT_LIMIT)
        return { ok: false, error: 'comment_limit', message: '这条动态下角色评论已达上限' };
      let reply: CommentRow | null = null;
      if (input.replyToCommentId) {
        try {
          reply = await this.replyTarget(tx.db, row.id, input.replyToCommentId);
          if (reply.authorKind === 'character') {
            const targetAccess = await this.characterAccess(
              tx,
              input.ownerUserId,
              row.id,
              reply.authorRefId,
            );
            if (!targetAccess.ok)
              return { ok: false, error: 'not_visible', message: '被回复的角色已不可见' };
          }
        } catch {
          return { ok: false, error: 'not_found', message: '被回复的评论不存在' };
        }
      }
      const commentId = await this.insertComment(tx, row, {
        authorKind: 'character',
        authorRefId: input.characterId,
        reply,
        text,
        mentionsUser: !!input.mentionsUser,
        createKey: input.idempotencyKey,
      });
      return { ok: true, value: { commentId } };
    });
  }

  // ---------- 删除清单（注销） ----------

  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const n = await this.countUserData(userId, tx.db);
      // 子表（图片、可见范围、点赞、评论）随动态级联删除。
      await tx.db.delete(posts).where(eq(posts.ownerUserId, userId));
      await tx.db.delete(badgeState).where(eq(badgeState.userId, userId));
      return n;
    });
  }
  async countUserData(userId: string, runner: Runner = this.db.db): Promise<number> {
    const result = await runner.execute<{ n: string }>(sql`SELECT
      (SELECT count(*) FROM moments.posts WHERE owner_user_id = ${userId}) +
      (SELECT count(*) FROM moments.comments c JOIN moments.posts p ON p.id = c.post_id WHERE p.owner_user_id = ${userId}) +
      (SELECT count(*) FROM moments.likes l JOIN moments.posts p ON p.id = l.post_id WHERE p.owner_user_id = ${userId}) +
      (SELECT count(*) FROM moments.badge_state WHERE user_id = ${userId}) AS n`);
    return Number(result.rows[0]?.n ?? 0);
  }

  // ---------- 内部 ----------

  private async activeIds(userId: string): Promise<Set<string>> {
    parseContract(Id, userId);
    return new Set((await this.contacts.listActiveContacts(userId)).map((c) => c.characterId));
  }
  private feedFilter(userId: string, active: Set<string>): SQL {
    return and(
      eq(posts.ownerUserId, userId),
      active.size
        ? or(eq(posts.authorKind, 'user'), inArray(posts.authorCharacterId, [...active]))
        : eq(posts.authorKind, 'user'),
    )!;
  }
  private async page(
    userId: string,
    active: Set<string>,
    query: { cursor?: string; limit: number },
    filter: SQL,
  ): Promise<{ items: MomentsPost[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit, 1), 30);
    const rows = await this.db.db
      .select()
      .from(posts)
      .where(
        and(
          filter,
          cursor
            ? or(
                lt(posts.createdAt, cursor.at),
                and(eq(posts.createdAt, cursor.at), lt(posts.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    const visible = rows.filter(
      (r) => r.authorKind === 'user' || (r.authorCharacterId && active.has(r.authorCharacterId)),
    );
    const pageRows = visible.slice(0, limit);
    return {
      items: await this.build(this.db.db, userId, pageRows, active),
      nextCursor: rows.length > limit ? encodeCursor(pageRows.at(-1)!) : null,
    };
  }
  private async findByKey(runner: Runner, ownerUserId: string, createKey: string) {
    const [row] = await runner
      .select()
      .from(posts)
      .where(and(eq(posts.ownerUserId, ownerUserId), eq(posts.createKey, createKey)));
    return row ?? null;
  }
  /** 用户能看的动态：自己的，或通讯录中 active 角色的。 */
  private async visiblePostForUser(
    runner: Runner,
    userId: string,
    postId: string,
    active: Set<string>,
  ): Promise<PostRow> {
    parseContract(Id, postId);
    const [row] = await runner
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.ownerUserId, userId)));
    if (
      !row ||
      (row.authorKind === 'character' &&
        !(row.authorCharacterId && active.has(row.authorCharacterId)))
    )
      throw new AppError('not_found', '动态不存在');
    return row;
  }
  /** 角色能否看到 / 互动：角色必须在通讯录；用户的「部分可见」动态只有被选中的角色能看。 */
  private async characterAccess(
    tx: DbTx,
    ownerUserId: string,
    postId: string,
    characterId: string,
  ): Promise<
    { ok: true; row: PostRow } | { ok: false; error: 'not_found' | 'not_visible'; message: string }
  > {
    if (!Id.safeParse(postId).success)
      return { ok: false, error: 'not_found', message: '动态不存在' };
    const [row] = await tx.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.ownerUserId, ownerUserId)))
      .for('update');
    if (!row) return { ok: false, error: 'not_found', message: '动态不存在' };
    if (!(await this.contacts.getActiveContact(ownerUserId, characterId, tx as unknown as Tx)))
      return { ok: false, error: 'not_visible', message: '角色不在通讯录中' };
    if (row.authorKind === 'user' && row.visibilityKind === 'selected') {
      const [allowed] = await tx.db
        .select({ id: visibility.characterId })
        .from(visibility)
        .where(and(eq(visibility.postId, row.id), eq(visibility.characterId, characterId)));
      if (!allowed) return { ok: false, error: 'not_visible', message: '该角色看不到这条动态' };
    }
    return { ok: true, row };
  }
  private async replyTarget(
    runner: Runner,
    postId: string,
    commentId: string,
  ): Promise<CommentRow> {
    parseContract(Id, commentId);
    const [row] = await runner
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.postId, postId)));
    if (!row) throw new AppError('not_found', '评论不存在');
    return row;
  }
  /** 最后一条用户评论之后的角色评论数（SOC-08 第 5 条）。 */
  private async characterCommentsSinceUser(runner: Runner, postId: string): Promise<number> {
    const [last] = await runner
      .select({ at: comments.createdAt })
      .from(comments)
      .where(and(eq(comments.postId, postId), eq(comments.authorKind, 'user')))
      .orderBy(desc(comments.createdAt))
      .limit(1);
    const [row] = await runner
      .select({ n: count() })
      .from(comments)
      .where(
        and(
          eq(comments.postId, postId),
          eq(comments.authorKind, 'character'),
          last ? gt(comments.createdAt, last.at) : undefined,
        ),
      );
    return row?.n ?? 0;
  }
  private async characterLikeCount(runner: Runner, postId: string): Promise<number> {
    const [row] = await runner
      .select({ n: count() })
      .from(likes)
      .where(and(eq(likes.postId, postId), eq(likes.actorKind, 'character')));
    return row?.n ?? 0;
  }
  private async insertComment(
    tx: DbTx,
    post: PostRow,
    input: {
      authorKind: 'user' | 'character';
      authorRefId: string;
      reply: CommentRow | null;
      text: string;
      mentionsUser: boolean;
      createKey: string;
    },
  ): Promise<string> {
    const [existing] = await tx.db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.postId, post.id),
          eq(comments.authorKind, input.authorKind),
          eq(comments.authorRefId, input.authorRefId),
          eq(comments.createKey, input.createKey),
        ),
      );
    if (existing) return existing.id;
    const id = newId();
    await tx.db.insert(comments).values({
      id,
      postId: post.id,
      authorKind: input.authorKind,
      authorRefId: input.authorRefId,
      replyToCommentId: input.reply?.id ?? null,
      replyToKind: input.reply?.authorKind ?? null,
      replyToRefId: input.reply?.authorRefId ?? null,
      textCiphertext: await this.seal(post.ownerUserId, `moments:comment:${id}`, input.text, tx),
      mentionsUser: input.mentionsUser,
      createKey: input.createKey,
      createdAt: this.clock.now(),
    });
    await this.outbox.publish(tx, 'moments.comment_created', 'moments', {
      postId: post.id,
      commentId: id,
      ownerUserId: post.ownerUserId,
      postAuthorKind: post.authorKind as 'user' | 'character',
      postAuthorCharacterId: post.authorCharacterId,
      authorKind: input.authorKind,
      authorCharacterId: input.authorKind === 'character' ? input.authorRefId : null,
      replyToKind: (input.reply?.authorKind as 'user' | 'character' | undefined) ?? null,
      replyToCharacterId: input.reply?.authorKind === 'character' ? input.reply.authorRefId : null,
      mentionsUser: input.mentionsUser,
    });
    await this.postChanged(tx, post.ownerUserId, post.id, false);
    if (input.authorKind === 'character') await this.pushBadge(tx, post.ownerUserId);
    return id;
  }
  private async postChanged(tx: DbTx, userId: string, postId: string, deleted: boolean) {
    await this.sync.appendUpdate(tx, userId, {
      type: 'moments.post_changed',
      data: { postId, deleted },
    });
  }
  private async pushBadge(tx: DbTx, userId: string) {
    const badge = await this.badge(tx.db, userId, await this.activeIds(userId));
    await this.sync.appendUpdate(tx, userId, { type: 'moments.badge_updated', data: { badge } });
  }
  private async badge(runner: Runner, userId: string, active: Set<string>): Promise<MomentsBadge> {
    let [state] = await runner.select().from(badgeState).where(eq(badgeState.userId, userId));
    if (!state) {
      const at = this.clock.now();
      await runner
        .insert(badgeState)
        .values({ userId, postsSeenAt: at, interactionsSeenAt: at })
        .onConflictDoNothing();
      state = { userId, postsSeenAt: at, interactionsSeenAt: at };
    }
    const ids = [...active];
    let unseenPostCount = 0;
    const characterIds: string[] = [];
    let unseenInteractionCount = 0;
    if (ids.length) {
      const fresh = await runner
        .select({ author: posts.authorCharacterId })
        .from(posts)
        .where(
          and(
            eq(posts.ownerUserId, userId),
            eq(posts.authorKind, 'character'),
            inArray(posts.authorCharacterId, ids),
            gt(posts.createdAt, state.postsSeenAt),
          ),
        )
        .orderBy(desc(posts.createdAt));
      unseenPostCount = fresh.length;
      for (const { author } of fresh)
        if (author && !characterIds.includes(author) && characterIds.length < 3)
          characterIds.push(author);
      const [likeCount] = await runner
        .select({ n: count() })
        .from(likes)
        .innerJoin(posts, eq(posts.id, likes.postId))
        .where(
          and(
            eq(posts.ownerUserId, userId),
            eq(posts.authorKind, 'user'),
            eq(likes.actorKind, 'character'),
            inArray(likes.actorRefId, ids),
            gt(likes.createdAt, state.interactionsSeenAt),
          ),
        );
      const [commentCount] = await runner
        .select({ n: count() })
        .from(comments)
        .innerJoin(posts, eq(posts.id, comments.postId))
        .where(
          and(
            eq(posts.ownerUserId, userId),
            eq(comments.authorKind, 'character'),
            inArray(comments.authorRefId, ids),
            gt(comments.createdAt, state.interactionsSeenAt),
            or(
              eq(posts.authorKind, 'user'),
              eq(comments.replyToKind, 'user'),
              eq(comments.mentionsUser, true),
            ),
          ),
        );
      unseenInteractionCount = (likeCount?.n ?? 0) + (commentCount?.n ?? 0);
    }
    return MomentsBadge.parse({ unseenPostCount, characterIds, unseenInteractionCount });
  }
  /** 组装 MomentsPost：只保留用户本人和通讯录中 active 角色的点赞、评论（SOC-08 第 3 条）。 */
  private async build(
    runner: Runner,
    userId: string,
    rows: PostRow[],
    active: Set<string>,
  ): Promise<MomentsPost[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [mediaRows, visRows, likeRows, commentRows] = await Promise.all([
      runner
        .select()
        .from(postMedia)
        .where(inArray(postMedia.postId, ids))
        .orderBy(asc(postMedia.position)),
      runner.select().from(visibility).where(inArray(visibility.postId, ids)),
      runner.select().from(likes).where(inArray(likes.postId, ids)).orderBy(asc(likes.createdAt)),
      runner
        .select()
        .from(comments)
        .where(inArray(comments.postId, ids))
        .orderBy(asc(comments.createdAt), asc(comments.id)),
    ]);
    const visibleActor = (kind: string, ref: string) =>
      kind === 'user' ? ref === userId : active.has(ref);
    const result: MomentsPost[] = [];
    for (const row of rows) {
      const postLikes = likeRows.filter(
        (l) => l.postId === row.id && visibleActor(l.actorKind, l.actorRefId),
      );
      const postComments: MomentsComment[] = [];
      for (const c of commentRows) {
        if (c.postId !== row.id || !visibleActor(c.authorKind, c.authorRefId)) continue;
        postComments.push({
          commentId: c.id,
          author: { kind: c.authorKind as MomentsActor['kind'], refId: c.authorRefId },
          replyTo:
            c.replyToKind && c.replyToRefId
              ? { kind: c.replyToKind as MomentsActor['kind'], refId: c.replyToRefId }
              : null,
          replyToCommentId: c.replyToCommentId,
          text: await this.open(row.ownerUserId, `moments:comment:${c.id}`, c.textCiphertext),
          mentionsUser: c.mentionsUser,
          createdAt: c.createdAt.toISOString(),
        });
      }
      const selected = visRows.filter((v) => v.postId === row.id).map((v) => v.characterId);
      result.push(
        MomentsPost.parse({
          postId: row.id,
          author:
            row.authorKind === 'user'
              ? { kind: 'user', refId: row.ownerUserId }
              : { kind: 'character', refId: row.authorCharacterId },
          text: await this.open(row.ownerUserId, `moments:post:${row.id}`, row.textCiphertext),
          images: mediaRows
            .filter((m) => m.postId === row.id)
            .map((m) => ({ mediaId: m.mediaId, width: m.width, height: m.height })),
          link: row.link
            ? {
                url: row.link.url,
                title: row.link.title,
                source: row.link.source,
                description: row.link.description,
                coverMediaId: row.link.coverMediaId,
                appHint: row.link.appHint,
              }
            : null,
          visibility:
            row.authorKind === 'user'
              ? row.visibilityKind === 'selected'
                ? { kind: 'selected', characterIds: selected }
                : { kind: 'all_characters', characterIds: [] }
              : null,
          likes: postLikes.map((l) => ({ kind: l.actorKind, refId: l.actorRefId })),
          likedByMe: postLikes.some((l) => l.actorKind === 'user' && l.actorRefId === userId),
          comments: postComments,
          createdAt: row.createdAt.toISOString(),
        }),
      );
    }
    return result;
  }
  private async seal(owner: string, aad: string, text: string, tx: DbTx): Promise<Buffer> {
    return this.crypto.seal(owner, aad, text, tx);
  }
  private async open(owner: string, aad: string, cipher: Buffer): Promise<string> {
    const plain = await this.crypto.open(owner, aad, cipher);
    try {
      return plain.toString('utf8');
    } finally {
      plain.fill(0);
    }
  }
}

function toStoredLink(link: MomentsLinkInput): StoredLink {
  return {
    url: String(link.url).slice(0, 2000),
    title: String(link.title).slice(0, 100),
    source: link.source ? String(link.source).slice(0, 30) : null,
    description: null,
    coverMediaId: link.coverMediaId,
    appHint: link.appHint,
  };
}
