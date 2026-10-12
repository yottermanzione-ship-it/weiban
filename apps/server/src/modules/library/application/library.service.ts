/**
 * library：收藏（CHAT-11）与分享图数据（EXP-01、EXP-02），T-078。
 *
 * - 收藏时复制内容快照（正文按用户数据密钥加密），原消息 / 动态被删除后收藏仍在。
 * - 同一来源重复收藏返回原收藏（幂等，唯一索引 user_id + source_kind + source_id）。
 * - 成人模式消息（scope = adult）、带「健康」标记的消息可以收藏，但 shareable = false（MODE-05 第 4 条、EXP-01 第 6 条）。
 * - 分享图：服务器准备可渲染内容；含不可选消息时 422 share_content_not_allowed，details.rejected 列出，不静默丢弃；
 *   撤回的消息不显示；含任何真人角色内容时贴纸文案为 weiban_not_real_person（EXP-01 第 5 条，不可关闭）。
 * - 只经对方模块的端口读取（ChatReadPort、PolicyPort、注入的 MomentsReadPort / 卡片查询），不碰别人的表（R8）。
 */
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import {
  AddFavoritesRequest,
  Favorite,
  Id,
  ReceivedMessageContent,
  ShareImageData,
  SharePreferences,
  ShareSource,
  ShareTemplate,
  type ChatReadPort,
  type CharacterReadPort,
  type MediaSystemPort,
  type Conversation,
  type MessageContent,
  type MomentsPost,
  type PolicyPort,
  type SyncPort,
  type Tx,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AppError,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  OUTBOX,
  USER_DATA_REGISTRY,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type EnvelopeCrypto,
  type Outbox,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CHARACTER_READ_PORT } from '../../characters/index.js';
import { MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { SYNC_PORT } from '../../realtime/index.js';
import { favorites, shareGenerations, sharePreferences } from '../infra/db/schema.js';
import {
  LIBRARY_CARD_LOOKUP,
  LIBRARY_MOMENTS_READ,
  type LibraryCardLookup,
  type LibraryMomentsRead,
} from '../tokens.js';

type FavoriteRow = typeof favorites.$inferSelect;
type FavoriteDto = z.infer<typeof Favorite>;
type ShareItem = ShareImageData['items'][number];
type Rejected = { id: string; reason: 'adult_scope' | 'health_label' | 'recalled' | 'not_found' };

const BATCH = 100;
const DEFAULT_TEMPLATE: ShareTemplate = 'pink_filter';

const encodeCursor = (row: FavoriteRow) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(at ?? '');
  if (!id || Number.isNaN(date.getTime()) || !Id.safeParse(id).success)
    throw new AppError('bad_request', '分页游标不正确');
  return { at: date, id };
}

/** 收藏搜索用的文字（文字、链接标题、信件、每日一问、语音原文）。 */
function textOf(content: z.infer<typeof ReceivedMessageContent>): string | null {
  switch (content.type) {
    case 'text':
      return content.text;
    case 'link':
      return `${content.title}\n${content.description ?? ''}`;
    case 'letter':
      return content.body;
    case 'daily_question':
      return `${content.question}\n${content.answer}`;
    case 'voice':
      return content.transcript;
    default:
      return null;
  }
}

function rejectReason(
  scope: string,
  labels: readonly string[] | undefined,
): Rejected['reason'] | null {
  if (scope === 'adult') return 'adult_scope';
  if (labels?.includes('health')) return 'health_label';
  return null;
}

/** 朋友圈动态 → 收藏快照（text 内容 + 图片另列）。 */
function postSnapshot(post: MomentsPost): { content: MessageContent; extraImages: string[] } {
  const images = post.images.map((i) => i.mediaId);
  if (post.text.trim()) return { content: { type: 'text', text: post.text }, extraImages: images };
  if (post.link) return { content: { type: 'link', ...post.link }, extraImages: images };
  const [first, ...rest] = post.images;
  if (!first) return { content: { type: 'text', text: ' ' }, extraImages: [] };
  return {
    content: { type: 'image', mediaId: first.mediaId, width: first.width, height: first.height },
    extraImages: rest.map((i) => i.mediaId),
  };
}

@Injectable()
export class LibraryService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(SYNC_PORT) private readonly sync: SyncPort,
    @Inject(CHARACTER_READ_PORT) private readonly characters: CharacterReadPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly mediaSystem: MediaSystemPort,
    @Optional() @Inject(LIBRARY_MOMENTS_READ) private readonly moments?: LibraryMomentsRead,
    @Optional() @Inject(LIBRARY_CARD_LOOKUP) private readonly cards?: LibraryCardLookup,
  ) {}

  onModuleInit(): void {
    // 本模块删除清单：收藏、分享偏好、生成次数。
    this.registry.register({
      module: 'library',
      purgeUser: (userId) => this.purgeUser(userId),
      countUserData: (userId) => this.countUserData(userId),
    });
  }

  // ---------- 收藏 ----------

  async listFavorites(
    userId: string,
    query: { characterId?: string; q?: string; cursor?: string; limit: number },
  ): Promise<{ items: FavoriteDto[]; nextCursor: string | null }> {
    let cursor = decodeCursor(query.cursor);
    const needle = query.q?.toLowerCase();
    const items: FavoriteDto[] = [];
    let lastRow: FavoriteRow | null = null;
    let hasMore = false;
    for (;;) {
      const rows = await this.db.db
        .select()
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            query.characterId ? eq(favorites.characterId, query.characterId) : undefined,
            cursor
              ? or(
                  lt(favorites.createdAt, cursor.at),
                  and(eq(favorites.createdAt, cursor.at), lt(favorites.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(favorites.createdAt), desc(favorites.id))
        .limit(BATCH);
      for (const row of rows) {
        const dto = await this.dto(row);
        if (needle) {
          const text = textOf(dto.content);
          if (!text || !text.toLowerCase().includes(needle)) continue;
        }
        if (items.length >= query.limit) {
          hasMore = true;
          break;
        }
        items.push(dto);
        lastRow = row;
      }
      if (hasMore || rows.length < BATCH) break;
      const tail = rows.at(-1)!;
      cursor = { at: tail.createdAt, id: tail.id };
    }
    return { items, nextCursor: hasMore && lastRow ? encodeCursor(lastRow) : null };
  }

  async addFavorites(userId: string, input: unknown): Promise<{ items: FavoriteDto[] }> {
    const body = parseContract(AddFavoritesRequest, input);
    type Pending = Omit<
      FavoriteRow,
      | 'id'
      | 'createdAt'
      | 'contentCiphertext'
      | 'userId'
      | 'characterNameSnapshot'
      | 'characterAvatarMediaIdSnapshot'
      | 'sourceSeq'
    > & {
      content: MessageContent;
      sourceSeq?: number | null;
    };
    const resolved: Array<{
      kind: 'message' | 'moments_post';
      sourceId: string;
      pending: Pending | null;
    }> = [];
    const conversations = new Map<string, Conversation | null>();
    for (const item of body.items) {
      const kind = item.kind;
      const sourceId = kind === 'message' ? item.messageId : item.postId;
      if (resolved.some((r) => r.kind === kind && r.sourceId === sourceId)) continue;
      const [existing] = await this.db.db
        .select({ id: favorites.id })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.sourceKind, kind),
            eq(favorites.sourceId, sourceId),
          ),
        );
      if (existing) {
        resolved.push({ kind, sourceId, pending: null });
        continue;
      }
      if (item.kind === 'message') {
        const conversation = await this.ownConversation(userId, item.conversationId, conversations);
        const message = await this.chat.getMessage(item.messageId, ['normal', 'adult']);
        if (
          !conversation ||
          !message ||
          message.conversationId !== item.conversationId ||
          message.status === 'recalled' ||
          !message.content ||
          message.content.type === 'unsupported'
        )
          throw new AppError('not_found', '消息不存在或已撤回', {
            details: { messageId: item.messageId },
          });
        const sender = this.sender(conversation, message.senderParticipantId);
        const senderKind =
          message.senderKind === 'system' ? 'system' : (sender?.kind ?? message.senderKind);
        const senderRefId = message.senderKind === 'system' ? null : (sender?.refId ?? null);
        resolved.push({
          kind,
          sourceId,
          pending: {
            sourceKind: 'message',
            sourceId,
            conversationId: item.conversationId,
            senderKind,
            senderRefId,
            characterId: senderKind === 'character' ? senderRefId : null,
            contentType: message.content.type,
            content: message.content as MessageContent,
            extraImages: [],
            scope: message.scope,
            labels: message.labels ?? [],
            sourceCreatedAt: new Date(message.createdAt),
            sourceSeq: message.seq,
          },
        });
      } else {
        const post = this.moments ? await this.moments.getPost(userId, item.postId) : null;
        if (!post)
          throw new AppError('not_found', '动态不存在', { details: { postId: item.postId } });
        const snap = postSnapshot(post);
        resolved.push({
          kind,
          sourceId,
          pending: {
            sourceKind: 'moments_post',
            sourceId,
            conversationId: null,
            senderKind: post.author.kind,
            senderRefId: post.author.refId,
            characterId: post.author.kind === 'character' ? post.author.refId : null,
            contentType: snap.content.type,
            content: snap.content,
            extraImages: snap.extraImages,
            scope: 'normal',
            labels: [],
            sourceCreatedAt: new Date(post.createdAt),
          },
        });
      }
    }

    // 3.1（积压 ㉔）：角色名字 / 头像快照。头像复制一份归本人所有（角色删除后仍可显示），收藏删除时一并删。
    const snapshots = new Map<string, { name: string | null; avatarMediaId: string | null }>();
    for (const r of resolved) {
      const characterId = r.pending?.characterId;
      if (!r.pending || !characterId) continue;
      snapshots.set(`${r.kind}:${r.sourceId}`, await this.characterSnapshot(userId, characterId));
    }
    const unusedCopies: string[] = [];
    const ids = await this.db.transaction(async (tx) => {
      const ids: string[] = [];
      const added: string[] = [];
      for (const r of resolved) {
        if (r.pending) {
          const id = newId();
          const { content, ...rest } = r.pending;
          const snap = snapshots.get(`${r.kind}:${r.sourceId}`);
          const sealed = await this.crypto.seal(
            userId,
            `library:favorite:${id}`,
            JSON.stringify(content),
            tx,
          );
          const inserted = await tx.db
            .insert(favorites)
            .values({
              ...rest,
              id,
              userId,
              contentCiphertext: sealed,
              characterNameSnapshot: snap?.name ?? null,
              characterAvatarMediaIdSnapshot: snap?.avatarMediaId ?? null,
              sourceSeq: rest.sourceSeq ?? null,
              createdAt: this.clock.now(),
            })
            .onConflictDoNothing()
            .returning({ id: favorites.id });
          if (inserted.length) added.push(id);
          else if (snap?.avatarMediaId) unusedCopies.push(snap.avatarMediaId);
        }
        const [row] = await tx.db
          .select({ id: favorites.id })
          .from(favorites)
          .where(
            and(
              eq(favorites.userId, userId),
              eq(favorites.sourceKind, r.kind),
              eq(favorites.sourceId, r.sourceId),
            ),
          );
        if (row) ids.push(row.id);
      }
      if (added.length) {
        const [count] = await tx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(favorites)
          .where(eq(favorites.userId, userId));
        await this.outbox.publish(tx, 'library.favorite_added', 'library', {
          userId,
          favoriteIds: added,
          totalFavorites: Math.max(1, count?.n ?? added.length),
        });
        await this.dataChanged(tx, userId, added.length === 1 ? added[0]! : null);
      }
      return ids;
    });
    for (const mediaId of unusedCopies)
      await this.mediaSystem.deleteObject(mediaId).catch(() => {});
    const rows = ids.length
      ? await this.db.db
          .select()
          .from(favorites)
          .where(and(eq(favorites.userId, userId), inArray(favorites.id, ids)))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const items: FavoriteDto[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row) items.push(await this.dto(row));
    }
    return { items };
  }

  async removeFavorite(userId: string, favoriteId: string): Promise<void> {
    parseContract(Id, favoriteId);
    await this.db.transaction(async (tx) => {
      const removed = await tx.db
        .delete(favorites)
        .where(and(eq(favorites.userId, userId), eq(favorites.id, favoriteId)))
        .returning({
          id: favorites.id,
          avatar: favorites.characterAvatarMediaIdSnapshot,
        });
      // 重复取消不报错（幂等）。
      if (removed.length) {
        if (removed[0]!.avatar)
          await this.mediaSystem.deleteObject(removed[0]!.avatar, tx as unknown as Tx);
        await this.dataChanged(tx, userId, favoriteId);
      }
    });
  }

  /** 收藏时的角色名字与头像快照；头像复制一份归本人（用途 contact_avatar，随收藏删除）。读不到时为空。 */
  private async characterSnapshot(
    userId: string,
    characterId: string,
  ): Promise<{ name: string | null; avatarMediaId: string | null }> {
    const [profile] = await this.characters.getProfiles(userId, [characterId]).catch(() => []);
    if (!profile) return { name: null, avatarMediaId: null };
    let avatarMediaId: string | null = null;
    if (profile.avatar.image)
      avatarMediaId = await this.mediaSystem
        .copyObject({
          mediaId: profile.avatar.image.mediaId,
          ownerUserId: userId,
          purpose: 'contact_avatar',
        })
        .then((m) => m.mediaId)
        .catch(() => null);
    return { name: profile.name.slice(0, 32), avatarMediaId };
  }

  // ---------- 分享图 ----------

  async prepareShare(userId: string, input: unknown): Promise<ShareImageData> {
    const { source } = parseContract(z.object({ source: ShareSource }), input);
    const rejected: Rejected[] = [];
    const items: ShareItem[] = [];
    let cardId: string | null = null;
    const involved = new Set<string>();

    if (source.kind === 'messages') {
      const conversation = await this.ownConversation(userId, source.conversationId, new Map());
      if (!conversation) throw new AppError('not_found', '会话不存在');
      const picked: Array<{ seq: number; item: ShareItem }> = [];
      let recalled = 0;
      for (const messageId of [...new Set(source.messageIds)]) {
        const message = await this.chat.getMessage(messageId, ['normal', 'adult']);
        if (!message || message.conversationId !== source.conversationId) {
          rejected.push({ id: messageId, reason: 'not_found' });
          continue;
        }
        const reason = rejectReason(message.scope, message.labels);
        if (reason) {
          rejected.push({ id: messageId, reason });
          continue;
        }
        // 撤回的消息不显示（EXP-01 第 6 条）；系统提示不进分享图。
        if (message.status === 'recalled' || !message.content) {
          recalled += 1;
          continue;
        }
        if (message.senderKind === 'system') continue;
        const sender = this.sender(conversation, message.senderParticipantId);
        const characterId = message.senderKind === 'character' ? (sender?.refId ?? null) : null;
        if (characterId) involved.add(characterId);
        picked.push({
          seq: message.seq,
          item: {
            senderKind: message.senderKind,
            characterId,
            content: message.content,
            createdAt: message.createdAt,
          },
        });
      }
      picked.sort((a, b) => a.seq - b.seq);
      items.push(...picked.map((p) => p.item));
      if (!rejected.length && !items.length && recalled)
        for (const messageId of source.messageIds)
          rejected.push({ id: messageId, reason: 'recalled' });
    } else if (source.kind === 'favorites') {
      const ids = [...new Set(source.favoriteIds)];
      const rows = await this.db.db
        .select()
        .from(favorites)
        .where(and(eq(favorites.userId, userId), inArray(favorites.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const picked: FavoriteRow[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) {
          rejected.push({ id, reason: 'not_found' });
          continue;
        }
        const reason = rejectReason(row.scope, row.labels);
        if (reason) {
          rejected.push({ id, reason });
          continue;
        }
        if (row.senderKind === 'system') continue;
        picked.push(row);
      }
      picked.sort((a, b) => a.sourceCreatedAt.getTime() - b.sourceCreatedAt.getTime());
      for (const row of picked) {
        const content = await this.openContent(row);
        const senderKind = row.senderKind === 'character' ? 'character' : 'user';
        const characterId = senderKind === 'character' ? row.senderRefId : null;
        if (characterId) involved.add(characterId);
        items.push({
          senderKind,
          characterId,
          content,
          createdAt: row.sourceCreatedAt.toISOString(),
        });
        for (const mediaId of row.extraImages) {
          if (items.length >= 30) break;
          items.push({
            senderKind,
            characterId,
            content: { type: 'image', mediaId, width: null, height: null },
            createdAt: row.sourceCreatedAt.toISOString(),
          });
        }
      }
    } else if (source.kind === 'moments_post') {
      const post = this.moments ? await this.moments.getPost(userId, source.postId) : null;
      if (!post) rejected.push({ id: source.postId, reason: 'not_found' });
      else {
        const senderKind = post.author.kind;
        const characterId = senderKind === 'character' ? post.author.refId : null;
        if (characterId) involved.add(characterId);
        const at = post.createdAt;
        if (post.text.trim())
          items.push({
            senderKind,
            characterId,
            content: { type: 'text', text: post.text },
            createdAt: at,
          });
        if (post.link)
          items.push({
            senderKind,
            characterId,
            content: { type: 'link', ...post.link },
            createdAt: at,
          });
        for (const image of post.images)
          items.push({
            senderKind,
            characterId,
            content: {
              type: 'image',
              mediaId: image.mediaId,
              width: image.width,
              height: image.height,
            },
            createdAt: at,
          });
      }
    } else {
      const characterId = this.cards
        ? await this.cards.getCardCharacterId(userId, source.cardId)
        : null;
      if (!characterId) rejected.push({ id: source.cardId, reason: 'not_found' });
      else {
        involved.add(characterId);
        cardId = source.cardId;
      }
    }

    if (rejected.length)
      throw new AppError(
        'share_content_not_allowed',
        rejected.some((r) => r.reason === 'adult_scope' || r.reason === 'health_label')
          ? '成人模式 / 健康相关的消息不能生成分享图'
          : '部分内容不存在或已撤回，不能生成分享图',
        { details: { rejected } },
      );

    const characterIds = [...involved];
    let realPerson = false;
    for (const characterId of characterIds) {
      const policy = await this.policy.getCharacterPolicy(userId, characterId).catch(() => null);
      // 查不到策略（角色已删除等）时保守按真人处理。
      if (!policy || policy.isRealPerson || policy.shareImageLabel === 'not_real_person') {
        realPerson = true;
        break;
      }
    }
    return ShareImageData.parse({
      label: realPerson ? 'weiban_not_real_person' : 'weiban',
      items: items.slice(0, 30),
      cardId,
      characterIds,
    });
  }

  async recordGenerated(userId: string, input: unknown): Promise<void> {
    const { template } = parseContract(z.object({ template: ShareTemplate }), input);
    await this.db.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db
        .insert(shareGenerations)
        .values({ userId, template, count: 1, updatedAt: now })
        .onConflictDoUpdate({
          target: [shareGenerations.userId, shareGenerations.template],
          set: { count: sql`${shareGenerations.count} + 1`, updatedAt: now },
        });
      await this.outbox.publish(tx, 'library.share_image_generated', 'library', {
        userId,
        template,
      });
    });
  }

  async getPreferences(userId: string): Promise<z.infer<typeof SharePreferences>> {
    const [row] = await this.db.db
      .select()
      .from(sharePreferences)
      .where(eq(sharePreferences.userId, userId));
    const parsed = ShareTemplate.safeParse(row?.defaultTemplate);
    return { defaultTemplate: parsed.success ? parsed.data : DEFAULT_TEMPLATE };
  }

  async updatePreferences(
    userId: string,
    input: unknown,
  ): Promise<z.infer<typeof SharePreferences>> {
    const body = parseContract(SharePreferences, input);
    const now = this.clock.now();
    await this.db.db
      .insert(sharePreferences)
      .values({ userId, defaultTemplate: body.defaultTemplate, updatedAt: now })
      .onConflictDoUpdate({
        target: sharePreferences.userId,
        set: { defaultTemplate: body.defaultTemplate, updatedAt: now },
      });
    return body;
  }

  // ---------- 内部 ----------

  private async ownConversation(
    userId: string,
    conversationId: string,
    cache: Map<string, Conversation | null>,
  ): Promise<Conversation | null> {
    if (cache.has(conversationId)) return cache.get(conversationId)!;
    const conversation = await this.chat.getConversation(conversationId);
    const own =
      conversation &&
      [...conversation.participants, ...(conversation.group?.formerParticipants ?? [])].some(
        (p) => p.kind === 'user' && p.refId === userId,
      )
        ? conversation
        : null;
    cache.set(conversationId, own);
    return own;
  }

  private sender(conversation: Conversation, participantId: string) {
    return [...conversation.participants, ...(conversation.group?.formerParticipants ?? [])].find(
      (p) => p.participantId === participantId,
    );
  }

  private async openContent(row: FavoriteRow) {
    const plain = await this.crypto.open(
      row.userId,
      `library:favorite:${row.id}`,
      row.contentCiphertext,
    );
    try {
      return ReceivedMessageContent.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }

  private async dto(row: FavoriteRow): Promise<FavoriteDto> {
    const reason = rejectReason(row.scope, row.labels);
    const source =
      row.sourceKind === 'message'
        ? {
            kind: 'message' as const,
            conversationId: row.conversationId!,
            messageId: row.sourceId,
            senderKind: (row.senderKind ?? 'system') as 'user' | 'character' | 'system',
            senderRefId: row.senderRefId,
            ...(row.sourceSeq ? { seq: row.sourceSeq } : {}),
          }
        : {
            kind: 'moments_post' as const,
            postId: row.sourceId,
            authorCharacterId: row.characterId,
          };
    return Favorite.parse({
      favoriteId: row.id,
      source,
      characterId: row.characterId,
      content: await this.openContent(row),
      extraImages: row.extraImages.slice(0, 9),
      characterNameSnapshot: row.characterNameSnapshot,
      characterAvatarMediaIdSnapshot: row.characterAvatarMediaIdSnapshot,
      shareable: !reason && row.senderKind !== 'system',
      notShareableReason: reason,
      sourceCreatedAt: row.sourceCreatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    });
  }

  private async dataChanged(tx: DbTx, userId: string, itemId: string | null): Promise<void> {
    await this.sync.appendUpdate(tx as unknown as Tx, userId, {
      type: 'data.changed',
      data: { section: 'favorites', characterId: null, itemId },
    });
  }

  private async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      let n = 0;
      // 3.1：收藏头像快照（library 自己复制的媒体对象）一并删除。
      const copies = await tx.db
        .select({ mediaId: favorites.characterAvatarMediaIdSnapshot })
        .from(favorites)
        .where(eq(favorites.userId, userId));
      for (const c of copies)
        if (c.mediaId) await this.mediaSystem.deleteObject(c.mediaId, tx as unknown as Tx);
      for (const table of [favorites, sharePreferences, shareGenerations] as const) {
        const r = await tx.db.delete(table).where(eq(table.userId, userId));
        n += r.rowCount ?? 0;
      }
      return n;
    });
  }

  private async countUserData(userId: string): Promise<number> {
    let n = 0;
    for (const table of [favorites, sharePreferences, shareGenerations] as const) {
      const [r] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.userId, userId));
      n += r?.n ?? 0;
    }
    return n;
  }
}
