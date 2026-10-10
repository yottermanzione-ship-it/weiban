/**
 * 聊天记录搜索（CHAT-12，ADR-0027，T-078）。
 *
 * 实现说明：消息正文按用户数据密钥加密存放（content_ciphertext），数据库里没有明文，
 * 所以 ADR-0027 设想的 pg_trgm 明文索引无法直接建（见 docs/backend/library-search.md，已上报架构）。
 * 本实现在服务器内存中逐条解密匹配：先用明文列（content_type / status / scope）在数据库侧筛掉不可搜的消息，
 * 再按 seq 倒序分批解密。个人测试规模（单用户数万条）下可接受；超出后按 ADR-0027「代价」再评估。
 *
 * 只搜文字类内容：文字、链接标题、信件正文、每日一问（题目 + 回答）、角色语音原文。
 * 不返回：已撤回、本人已删除（hidden_messages）、已清空（seq ≤ clearedThroughSeq）的消息。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import {
  ConversationSearchGroup,
  GlobalSearchResult,
  Id,
  MessageSearchHit,
  SearchKeyword,
  type IdentityReadPort,
  type Message,
  type MessageContent,
} from '@weiban/contracts';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import {
  AppError,
  DATABASE,
  parseContract,
  type Database,
  type DbTx,
} from '../../../platform/index.js';
import { conversations, messages } from '../infra/db/schema.js';
import { CHAT_GROUP_DIRECTORY, type ChatGroupDirectory } from '../tokens.js';
import { ChatStore, type ConversationRow, type MessageRow } from './store.js';

/** 可搜索的内容类型（明文列 content_type）。0030 之前的旧消息 content_type 为空，解密后再判断。 */
export const SEARCHABLE_CONTENT_TYPES = ['text', 'link', 'letter', 'daily_question', 'voice'];
const BATCH = 200;
const SNIPPET_SIDE = 20;
const GLOBAL_MAX = 20;

/** 从消息内容取可搜索文字；不可搜返回 null。 */
export function searchableText(content: MessageContent | null, senderKind: string): string | null {
  if (!content) return null;
  switch (content.type) {
    case 'text':
      return content.text;
    case 'link':
      return content.title;
    case 'letter':
      return content.body;
    case 'daily_question':
      return `${content.question}\n${content.answer}`;
    case 'voice':
      return senderKind === 'character' ? content.transcript : null;
    default:
      return null;
  }
}

/** 命中处前后各约 20 字的摘录（不超过 120 字）。 */
export function makeSnippet(text: string, keyword: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(keyword.toLowerCase());
  const chars = Array.from(flat);
  if (at < 0) return chars.slice(0, 2 * SNIPPET_SIDE).join('');
  // 换算为码点位置，避免切断 emoji。
  const cpAt = Array.from(flat.slice(0, at)).length;
  const kwLen = Array.from(keyword).length;
  const from = Math.max(0, cpAt - SNIPPET_SIDE);
  const to = Math.min(chars.length, cpAt + kwLen + SNIPPET_SIDE);
  let out = chars.slice(from, to).join('');
  if (from > 0) out = `…${out}`;
  if (to < chars.length) out = `${out}…`;
  return Array.from(out).slice(0, 120).join('');
}

@Injectable()
export class ChatSearchService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Optional() @Inject(CHAT_GROUP_DIRECTORY) private readonly directory?: ChatGroupDirectory,
  ) {}

  private async ownConversation(tx: DbTx, userId: string, conversationId: string) {
    parseContract(Id, conversationId);
    await this.store.requireActive(tx, userId);
    const [row] = await tx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!row) throw new AppError('not_found', '会话不存在');
    if (row.ownerUserId !== userId) throw new AppError('not_conversation_member', '不能访问此会话');
    return row;
  }

  /** 3.1 locateByDate：date 按用户时区解释，返回当天及之后第一条可见消息的 seq。 */
  async locateByDate(
    userId: string,
    conversationId: string,
    date: string,
  ): Promise<{ seq: number | null }> {
    const profile = await this.identity.getProfile(userId);
    const from = startOfLocalDay(date, profile?.timeZone ?? 'Asia/Shanghai');
    return this.db.transaction(async (tx) => {
      const row = await this.ownConversation(tx, userId, conversationId);
      const view = await this.store.view(tx, row, userId);
      let cursor = view.state.clearedThroughSeq;
      for (;;) {
        const batch = await tx.db
          .select({ id: messages.id, seq: messages.seq })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, row.id),
              gte(messages.createdAt, from),
              gt(messages.seq, cursor),
            ),
          )
          .orderBy(asc(messages.seq))
          .limit(BATCH);
        for (const m of batch) if (!view.hidden.has(m.id)) return { seq: m.seq };
        if (batch.length < BATCH) return { seq: null };
        cursor = batch.at(-1)!.seq;
      }
    });
  }

  /** 3.1 listByType：按类型 / 发送者列出（不含撤回、本人删除、已清空）。 */
  async listByType(
    userId: string,
    conversationId: string,
    query: {
      contentType?: 'image' | 'link' | 'voice' | 'sticker';
      senderParticipantId?: string;
      beforeSeq?: number;
      limit: number;
    },
  ): Promise<{ items: Message[]; hasMore: boolean }> {
    if (!query.contentType && !query.senderParticipantId)
      throw new AppError('bad_request', 'contentType 与 senderParticipantId 至少传一个');
    return this.db.transaction(async (tx) => {
      const row = await this.ownConversation(tx, userId, conversationId);
      const view = await this.store.view(tx, row, userId);
      const items: Message[] = [];
      let cursor = query.beforeSeq;
      for (;;) {
        const batch: MessageRow[] = await tx.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, row.id),
              eq(messages.status, 'normal'),
              gt(messages.seq, view.state.clearedThroughSeq),
              cursor === undefined ? undefined : lt(messages.seq, cursor),
              query.contentType ? eq(messages.contentType, query.contentType) : undefined,
              query.senderParticipantId
                ? eq(messages.senderParticipantId, query.senderParticipantId)
                : undefined,
            ),
          )
          .orderBy(desc(messages.seq))
          .limit(BATCH);
        for (const message of batch) {
          if (view.hidden.has(message.id)) continue;
          items.push(await this.store.message(tx, row, message, view));
          if (items.length > query.limit)
            return { items: items.slice(0, query.limit), hasMore: true };
        }
        if (batch.length < BATCH) return { items, hasMore: false };
        cursor = batch.at(-1)!.seq;
      }
    });
  }

  async searchConversation(
    userId: string,
    conversationId: string,
    query: { q: string; beforeSeq?: number; senderParticipantId?: string; limit: number },
  ): Promise<{ items: MessageSearchHit[]; hasMore: boolean }> {
    parseContract(Id, conversationId);
    const q = parseContract(SearchKeyword, query.q);
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const [row] = await tx.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (!row) throw new AppError('not_found', '会话不存在');
      if (row.ownerUserId !== userId)
        throw new AppError('not_conversation_member', '不能访问此会话');
      const hits = await this.scan(
        tx,
        row,
        userId,
        q,
        query.limit + 1,
        query.beforeSeq,
        query.senderParticipantId,
      );
      return {
        items: hits.slice(0, query.limit),
        hasMore: hits.length > query.limit,
      };
    });
  }

  async searchAll(userId: string, qInput: string): Promise<GlobalSearchResult> {
    const q = parseContract(SearchKeyword, qInput);
    const needle = q.toLowerCase();
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const rows = await tx.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.ownerUserId, userId), isNull(conversations.archivedAt)));

      const characterIds: string[] = [];
      const groupIds: string[] = [];
      const groups: z.infer<typeof ConversationSearchGroup>[] = [];
      for (const row of rows) {
        if (row.type === 'direct' && row.characterId && characterIds.length < GLOBAL_MAX) {
          const name = this.directory
            ? await this.directory.displayName(userId, row.characterId, tx).catch(() => null)
            : null;
          if (name && name.toLowerCase().includes(needle)) characterIds.push(row.characterId);
        }
        if (
          row.type === 'group' &&
          row.title &&
          row.title.toLowerCase().includes(needle) &&
          groupIds.length < GLOBAL_MAX
        )
          groupIds.push(row.id);
        const hits = await this.scan(tx, row, userId, q, Number.POSITIVE_INFINITY);
        if (hits.length)
          groups.push({ conversationId: row.id, matchCount: hits.length, latestHit: hits[0]! });
      }
      groups.sort((a, b) => b.latestHit.createdAt.localeCompare(a.latestHit.createdAt));
      return GlobalSearchResult.parse({
        characterIds,
        groupConversationIds: groupIds,
        messages: groups.slice(0, GLOBAL_MAX),
      });
    });
  }

  /** 在一个会话里按 seq 倒序找命中，最多 max 条。 */
  private async scan(
    tx: DbTx,
    row: ConversationRow,
    userId: string,
    keyword: string,
    max: number,
    beforeSeq?: number,
    senderParticipantId?: string,
  ): Promise<MessageSearchHit[]> {
    const view = await this.store.view(tx, row, userId);
    const needle = keyword.toLowerCase();
    const hits: MessageSearchHit[] = [];
    let cursor = beforeSeq;
    for (;;) {
      const batch: MessageRow[] = await tx.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.id),
            eq(messages.status, 'normal'),
            gt(messages.seq, view.state.clearedThroughSeq),
            cursor === undefined ? undefined : lt(messages.seq, cursor),
            senderParticipantId ? eq(messages.senderParticipantId, senderParticipantId) : undefined,
            or(
              inArray(messages.contentType, SEARCHABLE_CONTENT_TYPES),
              isNull(messages.contentType),
            ),
          ),
        )
        .orderBy(desc(messages.seq))
        .limit(BATCH);
      for (const message of batch) {
        if (view.hidden.has(message.id)) continue;
        const content = await this.store.content(tx, row, message).catch(() => null);
        const text = searchableText(content, message.senderKind);
        if (!text || !text.toLowerCase().includes(needle)) continue;
        hits.push(
          MessageSearchHit.parse({
            conversationId: row.id,
            messageId: message.id,
            seq: message.seq,
            senderParticipantId: message.senderParticipantId,
            senderKind: message.senderKind,
            snippet: makeSnippet(text, keyword),
            createdAt: message.createdAt.toISOString(),
          }),
        );
        if (hits.length >= max) return hits;
      }
      if (batch.length < BATCH) return hits;
      cursor = batch.at(-1)!.seq;
    }
  }
}

/** 某时区当地日期 0 点对应的时刻（迭代处理夏令时）；时区不认识时按北京时间。 */
export function startOfLocalDay(date: string, timeZone: string): Date {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'Asia/Shanghai';
  }
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const map: Record<string, number> = {};
    for (const p of f.formatToParts(new Date(guess))) map[p.type] = Number(p.value);
    const localAsUtc = Date.UTC(
      map.year!,
      map.month! - 1,
      map.day!,
      map.hour!,
      map.minute!,
      map.second!,
    );
    const next = target - (localAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
