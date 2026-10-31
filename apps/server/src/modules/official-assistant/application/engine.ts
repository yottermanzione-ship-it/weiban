/**
 * 小V同学客服回答引擎（方向 B §7.5，新写，不复用角色聊天路）。
 *
 * - 只取本会话近期文字历史（RECENT_HISTORY_LIMIT 条），不摘要、不长期记忆、不读角色记忆与脑；
 * - 确定性知识库条目直接按模板答（数字只来自简报占位符），未知条目直接按未知口径答，均不调模型；
 * - 其余走 small_v 线（平台付费、不扣用户积分、思考关、限频由网关执行），秒回、整条一个气泡、不拆分；
 * - 答不出/模型失败/限频时按固定文案答（未知口径 / 失败文案 / 超限占位文案），绝不编答案；
 * - 官方回复永不带扣费信息（charge），永不写角色记忆、永不触发角色回复规划（ai-runtime
 *   的订阅者只认 kind='character' 的参与者，官方会话天然不在其中，见 lifecycle 注释）。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OFFICIAL_IDENTITY_KEY,
  OFFICIAL_NAME,
  OFFICIAL_REF_ID,
  type ChatAdminPort,
  type ChatParticipantPort,
  type ChatReadPort,
  type Conversation,
  type ModelGatewayPlatformPort,
  type OfficialContact,
  type OfficialProfile,
  type Tx,
} from '@weiban/contracts';
import {
  DATABASE,
  AppError,
  type Database,
} from '../../../platform/index.js';
import { CHAT_ADMIN_PORT, CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { MODEL_PLATFORM_GATEWAY_PORT } from '../../model-access/index.js';
import {
  OFFICIAL_FAILURE_TEXT,
  OFFICIAL_NON_TEXT_TEXT,
  OFFICIAL_RATE_LIMIT_TEXT,
  OFFICIAL_SIGNATURE,
  OFFICIAL_TRIGGER_CONTENT_TYPES,
  OFFICIAL_UNKNOWN_TEXT,
  OFFICIAL_WELCOME_TEXT,
  RECENT_HISTORY_LIMIT,
  isOfficialConversation,
  officialParticipantOf,
} from '../domain/identity.js';
import {
  matchEntry,
  renderAnswer,
  type KnowledgeBaseFile,
} from '../domain/knowledge-base.js';
import { buildSystemPrompt, sanitizeReply, toModelMessages } from '../domain/prompt.js';
import { BriefService } from './brief.js';
import { OFFICIAL_KNOWLEDGE_BASE } from '../tokens.js';

export interface OfficialReplyJob {
  userId: string;
  conversationId: string;
  messageId: string;
  seq: number;
  contentType: string;
}

/** 调模型以外的用户消息只发固定提示、不猜内容；其余类型静默（拍一拍、表情包等不回）。 */
const NOTICE_CONTENT_TYPES = new Set(
  [...OFFICIAL_TRIGGER_CONTENT_TYPES].filter((t) => t !== 'text'),
);

@Injectable()
export class OfficialAssistantEngine {
  private readonly logger = new Logger(OfficialAssistantEngine.name);
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly participants: ChatParticipantPort,
    @Inject(MODEL_PLATFORM_GATEWAY_PORT)
    private readonly gateway: ModelGatewayPlatformPort,
    @Inject(BriefService) private readonly brief: BriefService,
    @Inject(OFFICIAL_KNOWLEDGE_BASE) private readonly kb: KnowledgeBaseFile,
  ) {}

  getProfile(): OfficialProfile {
    return {
      kind: 'official',
      identityKey: OFFICIAL_IDENTITY_KEY,
      refId: OFFICIAL_REF_ID,
      name: OFFICIAL_NAME,
      signature: OFFICIAL_SIGNATURE,
      // 头像沿用与否待确认（Q1）：null 时客户端用内置官方头像占位。
      avatarPath: null,
    };
  }

  async getContact(userId: string): Promise<OfficialContact> {
    const conversation = await this.chatRead.findOfficialConversation(userId);
    return { ...this.contactFields(), conversationId: conversation?.conversationId ?? null };
  }

  private contactFields(): Omit<OfficialContact, 'conversationId'> {
    return {
      kind: 'official',
      refId: OFFICIAL_REF_ID,
      name: OFFICIAL_NAME,
      signature: OFFICIAL_SIGNATURE,
      avatarPath: null,
    };
  }

  /**
   * 补齐官方会话（幂等）+ 首次创建时发一条欢迎语。
   * 自开事务（事件订阅者的事务只记收件箱，不复用）：重放时 ensure 幂等、欢迎语靠 writer
   * 幂等键去重，不会重复发。
   */
  async ensureConversation(userId: string): Promise<Conversation> {
    return this.database.transaction(async (tx) => {
      const conversation = await this.chatAdmin.ensureOfficialConversation(tx as Tx, { userId });
      const official = officialParticipantOf(conversation);
      if (!official) throw new AppError('internal_error', '官方会话缺少官方参与者');
      const existing = await this.chatRead.readMessages({
        conversationId: conversation.conversationId,
        scopes: ['normal'],
        limit: 1,
      });
      if (existing.length === 0) {
        const posted = await this.participants.postMessage(
          {
            conversationId: conversation.conversationId,
            senderParticipantId: official.participantId,
            content: { type: 'text', text: OFFICIAL_WELCOME_TEXT },
            idempotencyKey: `official:welcome:${userId}`,
          },
          tx as Tx,
        );
        if (!posted.ok) throw new AppError('internal_error', posted.message ?? '欢迎语未能发送');
      }
      return conversation;
    });
  }

  /** 处理一条用户在官方会话里发的消息；不是官方会话时返回 handled=false（不碰）。 */
  async answerForMessage(job: OfficialReplyJob): Promise<{ handled: boolean }> {
    const conversation = await this.chatRead.getConversation(job.conversationId);
    if (!conversation || !isOfficialConversation(conversation)) return { handled: false };
    if (conversation.contentScope !== 'normal') return { handled: false };
    const official = officialParticipantOf(conversation);
    if (!official) return { handled: false };
    if (job.contentType !== 'text' && !NOTICE_CONTENT_TYPES.has(job.contentType))
      return { handled: false };

    // 已有官方回复（重试/重放）时不再重复答。
    const after = await this.chatRead.readMessages({
      conversationId: job.conversationId,
      scopes: ['normal'],
      afterSeq: job.seq,
      limit: 5,
    });
    if (after.some((m) => m.senderKind === 'official')) return { handled: true };

    let posted: boolean;
    if (job.contentType === 'text') {
      posted = await this.answerText(job, conversation, official);
    } else {
      posted = await this.postReply(
        conversation,
        official,
        OFFICIAL_NON_TEXT_TEXT,
        `official:notice:${job.messageId}`,
      );
    }
    if (!posted) return { handled: false };
    await this.markRead(conversation, official, job.seq);
    return { handled: true };
  }

  /**
   * 文字回答：返回是否已发出回复。触发消息已不在时返回 true（无从回答、不重试）。
   */
  private async answerText(
    job: OfficialReplyJob,
    conversation: Conversation,
    official: { participantId: string },
  ): Promise<boolean> {
    const history = await this.chatRead.readMessages({
      conversationId: job.conversationId,
      scopes: ['normal'],
      beforeSeq: job.seq + 1,
      limit: RECENT_HISTORY_LIMIT,
      contentTypes: ['text'],
    });
    const turns = history
      .filter(
        (m): m is typeof m & { content: { type: 'text'; text: string } } =>
          m.content?.type === 'text' && (m.senderKind === 'user' || m.senderKind === 'official'),
      )
      .map((m) => ({
        senderKind: m.senderKind as 'user' | 'official',
        text: (m.content as { type: 'text'; text: string }).text,
      }));
    const trigger =
      turns.filter((t) => t.senderKind === 'user').at(-1) ??
      (await this.triggerText(job.messageId));
    if (!trigger) {
      // 触发消息已不在（被撤回/清空）：无从回答，不发空回复。
      return true;
    }
    const brief = await this.brief.assemble(job.userId);
    const matched = matchEntry(this.kb, trigger.text);
    if (matched?.entry.unknown) {
      return this.postReply(
        conversation,
        official,
        OFFICIAL_UNKNOWN_TEXT,
        `official:reply:${job.messageId}`,
      );
    }
    if (matched?.entry.deterministic) {
      const rendered = renderAnswer(matched.entry, brief.facts);
      if (rendered) {
        return this.postReply(conversation, official, rendered, `official:reply:${job.messageId}`);
      }
      // 占位符缺值（某项简报没查到）：降级走模型，提示词里注明该项未知。
    }
    const system = buildSystemPrompt({ briefLines: brief.promptLines, matched: matched?.entry ?? null });
    const result = await this.gateway.generatePlatformText({
      userId: job.userId,
      purpose: 'small_v',
      modelRole: 'background',
      conversationId: job.conversationId,
      messages: [{ role: 'system', content: system }, ...toModelMessages(turns)],
      maxOutputTokens: 800,
      idempotencyKey: `official:reply:${job.messageId}`,
    });
    let reply: string;
    if (result.ok) {
      const sanitized = sanitizeReply(result.value.text);
      if (sanitized) {
        // 思考关断言：small_v  purpose 的思考预算恒为 0；上游若报告思考 token，记日志备查。
        if (result.value.usage.reasoningTokens) {
          this.logger.warn(
            `small_v 调用报告思考 token（应为 0）：messageId=${job.messageId} reasoningTokens=${result.value.usage.reasoningTokens}`,
          );
        }
        reply = sanitized;
      } else {
        reply = OFFICIAL_FAILURE_TEXT;
      }
    } else if (result.error === 'budget_exceeded') {
      reply = OFFICIAL_RATE_LIMIT_TEXT;
    } else {
      this.logger.warn(
        `small_v 调用失败：messageId=${job.messageId} error=${result.error}`,
      );
      reply = OFFICIAL_FAILURE_TEXT;
    }
    return this.postReply(conversation, official, reply, `official:reply:${job.messageId}`);
  }

  private async triggerText(messageId: string): Promise<{ senderKind: 'user'; text: string } | null> {
    const message = await this.chatRead.getMessage(messageId, ['normal']);
    if (message?.content?.type === 'text' && message.senderKind === 'user')
      return { senderKind: 'user', text: message.content.text };
    return null;
  }

  /** 发一条官方回复（整条一个气泡、不拆分、不带扣费信息）；失败返回 false（调用方不重试空文案）。 */
  private async postReply(
    conversation: Conversation,
    official: { participantId: string },
    text: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    if (!text) return false;
    const posted = await this.participants.postMessage({
      conversationId: conversation.conversationId,
      senderParticipantId: official.participantId,
      content: { type: 'text', text },
      idempotencyKey,
    });
    if (!posted.ok) {
      this.logger.warn(
        `官方回复未能发出：conversationId=${conversation.conversationId} error=${posted.error}`,
      );
      return false;
    }
    return true;
  }

  /** 官方已读游标（供客户端显示“已读”）；失败不影响回复本身。 */
  private async markRead(
    conversation: Conversation,
    official: { participantId: string },
    readSeq: number,
  ): Promise<void> {
    try {
      await this.participants.markRead({
        conversationId: conversation.conversationId,
        participantId: official.participantId,
        readSeq,
      });
    } catch (error) {
      this.logger.warn(
        `官方已读游标更新失败：conversationId=${conversation.conversationId} ${(error as Error).message}`,
      );
    }
  }
}
