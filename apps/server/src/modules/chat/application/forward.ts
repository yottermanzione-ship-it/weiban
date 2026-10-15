import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  ForwardMessagesRequest,
  ForwardMessagesResponse,
  FORWARD_LIMITS,
  type ForwardSnapshotContent,
  type MessageContent,
  type IdentityReadPort,
  type MediaTranscriptPort,
} from '@weiban/contracts';
import {
  AppError,
  DATABASE,
  CLOCK,
  parseContract,
  type Database,
  type Clock,
} from '../../../platform/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { MEDIA_TRANSCRIPT_PORT } from '../../media/index.js';
import { CHAT_GROUP_DIRECTORY, type ChatGroupDirectory } from '../tokens.js';
import { forwardReceipts, messages, participants } from '../infra/db/schema.js';
import { ChatStore, type MessageRow, type ConversationRow } from './store.js';
import { ChatWriteService } from './write.js';

/** UUID-based keys retain existing user-message deduplication and sync/outbox semantics. */
function forwardMessageId(requestId: string, targetId: string, index: number): string {
  const hex = createHash('sha256').update(`${requestId}:${targetId}:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class ChatForwardService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ChatStore) private readonly store: ChatStore,
    @Inject(ChatWriteService) private readonly writer: ChatWriteService,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(MEDIA_TRANSCRIPT_PORT) private readonly transcripts: MediaTranscriptPort,
    @Optional() @Inject(CHAT_GROUP_DIRECTORY) private readonly directory?: ChatGroupDirectory,
  ) {}

  async forward(
    userId: string,
    sourceId: string,
    input: ForwardMessagesRequest,
  ): Promise<ForwardMessagesResponse> {
    const body = parseContract(ForwardMessagesRequest, input);
    const ids = [...new Set(body.messageIds)].sort();
    const targets = [...new Set(body.targetConversationIds)].sort();
    const mode = ids.length === 1 ? 'individual' : body.mode;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ sourceId, ids, targets, mode }))
      .digest('hex');
    const results: ForwardMessagesResponse['results'] = [];
    for (const targetId of targets) {
      try {
        const messageIds = await this.db.transaction(async (tx) => {
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended('chat:forward:' || $1 || ':' || $2,0))",
            [userId, body.clientRequestId],
          );
          const previous = await tx.db
            .select()
            .from(forwardReceipts)
            .where(
              and(
                eq(forwardReceipts.userId, userId),
                eq(forwardReceipts.requestId, body.clientRequestId),
              ),
            );
          if (previous.some((r) => r.fingerprint !== fingerprint))
            throw new AppError('conflict', '重试内容已变化，请重新发起转发');
          // Lock in stable order to avoid crossing forwards deadlocking each other.
          const rows = new Map<string, ConversationRow>();
          for (const id of [...new Set([sourceId, targetId])].sort())
            rows.set(id, await this.store.load(tx, id, userId));
          const source = rows.get(sourceId)!;
          const target = rows.get(targetId)!;
          const [receipt] = await tx.db
            .select()
            .from(forwardReceipts)
            .where(
              and(
                eq(forwardReceipts.userId, userId),
                eq(forwardReceipts.requestId, body.clientRequestId),
                eq(forwardReceipts.targetId, targetId),
              ),
            );
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              throw new AppError('conflict', '重试内容已变化，请重新发起转发');
            return receipt.messageIds;
          }
          if (
            source.archivedAt ||
            (source.trialExpiresAt && source.trialExpiresAt <= this.clock.now())
          )
            throw new AppError('not_conversation_member', '源会话已停止收发');
          const view = await this.store.view(tx, source, userId);
          await this.store.view(tx, target, userId);
          const members = await tx.db
            .select()
            .from(participants)
            .where(eq(participants.conversationId, sourceId));
          const targetMembers = await tx.db
            .select()
            .from(participants)
            .where(eq(participants.conversationId, targetId));
          const sender = targetMembers.find(
            (p) => p.kind === 'user' && p.refId === userId && !p.leftAt,
          );
          if (!sender || !members.some((p) => p.kind === 'user' && p.refId === userId && !p.leftAt))
            throw new AppError('not_conversation_member', '不在此会话中');
          const sourceMessages = await tx.db
            .select()
            .from(messages)
            .where(and(eq(messages.conversationId, sourceId), inArray(messages.id, ids)))
            .orderBy(asc(messages.seq));
          if (
            sourceMessages.length !== ids.length ||
            sourceMessages.some(
              (m) =>
                m.status !== 'normal' ||
                m.seq <= view.state.clearedThroughSeq ||
                view.hidden.has(m.id) ||
                m.senderKind === 'system',
            )
          )
            throw new AppError('bad_request', '选择中有已删除、已清空、已撤回或不能转发的消息');
          if (sourceMessages.some((m) => m.scope === 'adult') && target.contentScope !== 'adult')
            throw new AppError('forbidden', '私密消息只能转发到已开启私密模式且符合资格的聊天');
          const profile = await this.identity.getProfile(userId, tx);
          const names = new Map<string, string>();
          for (const member of members)
            names.set(
              member.id,
              member.kind === 'user'
                ? (profile?.nickname ?? '用户')
                : ((await this.directory?.displayName(userId, member.refId, tx)) ?? '角色'),
            );
          const items = [];
          for (const message of sourceMessages) {
            const content = await this.store.content(tx, source, message);
            if (!content) throw new AppError('bad_request', '消息已不可读取');
            let snapshot = this.snapshot(content, message, names);
            if (snapshot.type === 'voice' && !snapshot.transcript) {
              const transcript = await this.transcripts.getTranscript(snapshot.mediaId);
              if (transcript.status === 'ready' && transcript.text)
                snapshot = { ...snapshot, transcript: transcript.text };
            }
            items.push({
              senderName: (names.get(message.senderParticipantId) ?? '角色').slice(0, 100),
              senderKind: message.senderKind as 'user' | 'character',
              createdAt: message.createdAt.toISOString(),
              content: snapshot,
            });
          }
          const serialized = JSON.stringify(items);
          const chars = items.reduce((sum, i) => sum + this.textSize(i.content), 0);
          if (
            chars > FORWARD_LIMITS.textChars ||
            Buffer.byteLength(serialized) > FORWARD_LIMITS.snapshotBytes
          )
            throw new AppError('bad_request', '转发内容过长：最多 20,000 正文字、512 KiB 记录');
          const title =
            source.type === 'group'
              ? `${source.title ?? '群聊'}的聊天记录`
              : `${[...new Set(members.map((m) => names.get(m.id)))].join('和')}的聊天记录`;
          const contents: MessageContent[] =
            mode === 'merged'
              ? [{ type: 'forwarded_record', title: title.slice(0, 200), items }]
              : items.map((i) => i.content);
          const created: string[] = [];
          for (const [index, content] of contents.entries()) {
            const sourceLabels =
              mode === 'merged'
                ? [...new Set(sourceMessages.flatMap((m) => m.labels ?? []))]
                : (sourceMessages[index]!.labels ?? []);
            const labels = sourceLabels.includes('health')
              ? ['health', ...sourceLabels.filter((l) => l !== 'health').slice(0, 7)]
              : sourceLabels;
            const result = await this.writer.postForward(tx, target, {
              conversationId: targetId,
              senderParticipantId: sender.id,
              content,
              idempotencyKey: forwardMessageId(body.clientRequestId, targetId, index),
              labels,
            });
            if (!result.ok)
              throw new AppError('bad_request', result.message ?? '目标暂不能接收转发');
            created.push(result.value.messageId);
          }
          await tx.db.insert(forwardReceipts).values({
            userId,
            requestId: body.clientRequestId,
            targetId,
            fingerprint,
            messageIds: created,
          });
          return created;
        });
        results.push({ ok: true, conversationId: targetId, messageIds });
      } catch (error) {
        results.push({
          ok: false,
          conversationId: targetId,
          error: error instanceof AppError ? error.code : 'internal_error',
          message: error instanceof AppError ? error.message : '暂时无法转发，请用原请求重试',
        });
      }
    }
    return ForwardMessagesResponse.parse({ results });
  }

  private snapshot(
    c: MessageContent,
    row: MessageRow,
    names: Map<string, string>,
  ): ForwardSnapshotContent {
    switch (c.type) {
      case 'forwarded_record':
        throw new AppError('bad_request', '聊天记录暂不支持再次转发，请展开后选择原消息');
      case 'system':
        throw new AppError('bad_request', '系统提示不能转发');
      case 'text':
        return { type: 'text', text: c.text };
      case 'nudge':
        return {
          type: 'text',
          text: `${names.get(row.senderParticipantId) ?? '对方'}拍了拍${names.get(c.targetParticipantId) ?? '对方'}`,
        };
      case 'action_card':
        return {
          type: 'text',
          text: `[卡片快照] ${c.text}\n选项：${c.actions.map((a) => a.label).join(' / ')}${row.actionId ? `\n已选择：${c.actions.find((a) => a.actionId === row.actionId)?.label ?? row.actionId}` : '\n尚未选择'}（此转发不执行操作）`,
        };
      case 'call_record':
        return {
          type: 'text',
          text: `[通话记录] ${c.direction === 'outgoing' ? '呼出' : '呼入'}，${c.outcome}，${c.durationSec} 秒`,
        };
      default:
        return c;
    }
  }
  private textSize(c: ForwardSnapshotContent): number {
    switch (c.type) {
      case 'text':
        return c.text.length;
      case 'voice':
        return c.transcript?.length ?? 0;
      case 'letter':
        return c.body.length;
      case 'daily_question':
        return c.question.length + c.answer.length;
      case 'link':
        return c.title.length + c.url.length + (c.description?.length ?? 0);
      case 'sticker':
        return c.description?.length ?? 0;
      case 'contact_card':
        return c.name.length;
      default:
        return 0;
    }
  }
}
