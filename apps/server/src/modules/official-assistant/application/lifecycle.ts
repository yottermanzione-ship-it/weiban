/**
 * 官方身份的事件接线（方向 B）：
 * - 用户在官方会话发消息 → 投递回复任务（pg-boss 按会话合并），静默窗口结束后取最新一批；
 * - 新用户注册 → 补齐官方会话 + 欢迎语（老用户自动补走 HTTP ensure 端口，客户端启动时调）；
 * - 开关关掉（OFFICIAL_ASSISTANT_ENABLED=false）时不订阅、不跑任务，入口消失，已有数据不删。
 *
 * 守卫说明（角色边界，1.5 节清单）：ai-runtime、记忆、生态、群聊、朋友圈等订阅者
 * 只认 kind='character' 的参与者，官方会话（无角色参与者）天然不在其中，本模块不再逐个加守卫；
 * 本订阅者自己再认一次官方会话（isOfficialConversation），双重确认才投递。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  REPLY_QUIET_MS,
  type ChatReadPort,
  type ChatReplyTriggerReadPort,
  type IdentityAccountStatusPort,
} from '@weiban/contracts';
import {
  withReplySlot,
  APP_CONFIG,
  DATABASE,
  CLOCK,
  type Database,
  type Clock,
  EVENT_BUS,
  JOB_QUEUE,
  type AppConfig,
  type EventBus,
  type JobQueue,
} from '../../../platform/index.js';
import { CHAT_READ_PORT, CHAT_REPLY_TRIGGER_READ_PORT } from '../../chat/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { isOfficialConversation, OFFICIAL_TRIGGER_CONTENT_TYPES } from '../domain/identity.js';
import { OfficialAssistantEngine, type OfficialReplyJob } from './engine.js';

export const OFFICIAL_REPLY_JOB = 'official.reply';

@Injectable()
export class OfficialAssistantLifecycle implements OnModuleInit {
  private readonly logger = new Logger(OfficialAssistantLifecycle.name);
  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(CHAT_READ_PORT) private readonly chatRead: ChatReadPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT)
    private readonly accounts: IdentityAccountStatusPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHAT_REPLY_TRIGGER_READ_PORT) private readonly triggers: ChatReplyTriggerReadPort,
    @Inject(OfficialAssistantEngine) private readonly engine: OfficialAssistantEngine,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.officialAssistant.enabled) return;
    this.bus.subscribe({
      consumer: 'official.on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        if (p.scope !== 'normal') return;
        // T-20261104f：在本事务里读（kernel.md「事务与端口」）；之后只投递任务，不再拿别的锁。
        const conversation = await this.chatRead.getConversation(p.conversationId, tx);
        if (!conversation || !isOfficialConversation(conversation)) return;
        const window = await this.triggers.replyWindow(p.senderRefId, p.conversationId, tx, [
          ...OFFICIAL_TRIGGER_CONTENT_TYPES,
        ]);
        if (!window?.latest || window.latest.seq <= (conversation.peerReadSeq ?? 0)) return;
        await this.jobs.sendCoalesced<OfficialReplyJob>(
          OFFICIAL_REPLY_JOB,
          {
            userId: p.senderRefId,
            conversationId: p.conversationId,
            messageId: p.messageId,
            seq: p.seq,
            contentType: p.contentType,
          },
          {
            tx,
            startAfter:
              !window.partial && window.latest.firstSeq < window.latest.seq
                ? this.clock.now()
                : (window.quietUntil ?? new Date(this.clock.nowMs() + REPLY_QUIET_MS)),
            singletonKey: p.conversationId,
            retryLimit: 2,
            retryBackoff: true,
          },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'official.on_user_registered',
      eventType: 'identity.user_registered',
      handle: async (event, tx) => {
        const userId = event.payload.userId;
        // T-20261104f：补齐是自己一个事务（失败只记 warn，不能让收件箱记录跟着回滚重投），
        // 所以放到本订阅者事务提交之后做，不在拿着事务时另开连接（kernel.md「事务与端口」）。
        tx.afterCommit(async () => {
          try {
            if ((await this.accounts.getAccountStatus(userId)) !== 'active') return;
            await this.engine.ensureConversation(userId);
          } catch (error) {
            // 注册补齐失败不阻塞注册流程：老用户自动补走 HTTP ensure 端口兜底。
            this.logger.warn(`注册补齐官方会话失败：userId=${userId} ${(error as Error).message}`);
          }
        });
      },
    });
    await this.jobs.workCoalesced<OfficialReplyJob>(
      OFFICIAL_REPLY_JOB,
      async (job) => {
        const { userId, conversationId } = job.data;
        const latest = await this.db.transaction(async (tx) => {
          const window = await this.triggers.replyWindow(userId, conversationId, tx, [
            ...OFFICIAL_TRIGGER_CONTENT_TYPES,
          ]);
          if (!window?.latest) return null;
          if (window.partial) {
            await this.jobs.sendCoalesced(OFFICIAL_REPLY_JOB, job.data, {
              tx,
              singletonKey: conversationId,
              delayMs: 60_000,
              retryLimit: 2,
              retryBackoff: true,
            });
            return null;
          }
          if (window.quietUntil && window.quietUntil > this.clock.now()) {
            await this.jobs.sendCoalesced(OFFICIAL_REPLY_JOB, job.data, {
              tx,
              singletonKey: conversationId,
              startAfter: window.quietUntil,
              retryLimit: 2,
              retryBackoff: true,
            });
            return null;
          }
          return window.latest;
        });
        if (latest)
          await withReplySlot(
            this.db,
            this.clock,
            userId,
            conversationId,
            async () => {
              await this.engine.answerForMessage({ userId, conversationId, ...latest });
            },
            (when) =>
              this.jobs.sendCoalesced(OFFICIAL_REPLY_JOB, job.data, {
                singletonKey: conversationId,
                startAfter: when,
                retryLimit: 2,
                retryBackoff: true,
              }),
          );
      },
      (data) => data.conversationId,
      { pollingIntervalSeconds: 1, localConcurrency: 2 },
    );
  }
}
