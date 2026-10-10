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
import { and, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import {
  ConversationSearchGroup,
  GlobalSearchResult,
  Id,
  MessageSearchHit,
  SearchKeyword,
  type MessageContent,
} from '@weiban/contracts';
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
    @Optional() @Inject(CHAT_GROUP_DIRECTORY) private readonly directory?: ChatGroupDirectory,
  ) {}

  async searchConversation(
    userId: string,
    conversationId: string,
    query: { q: string; beforeSeq?: number; limit: number },
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
      const hits = await this.scan(tx, row, userId, q, query.limit + 1, query.beforeSeq);
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
