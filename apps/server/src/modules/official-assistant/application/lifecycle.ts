/**
 * 官方身份的事件接线（方向 B）：
 * - 用户在官方会话发消息 → 投递回复任务（pg-boss，单条消息单例），秒回由任务内引擎完成；
 * - 新用户注册 → 补齐官方会话 + 欢迎语（老用户自动补走 HTTP ensure 端口，客户端启动时调）；
 * - 开关关掉（OFFICIAL_ASSISTANT_ENABLED=false）时不订阅、不跑任务，入口消失，已有数据不删。
 *
 * 守卫说明（角色边界，1.5 节清单）：ai-runtime、记忆、生态、群聊、朋友圈等订阅者
 * 只认 kind='character' 的参与者，官方会话（无角色参与者）天然不在其中，本模块不再逐个加守卫；
 * 本订阅者自己再认一次官方会话（isOfficialConversation），双重确认才投递。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ChatReadPort, IdentityAccountStatusPort } from '@weiban/contracts';
import {
  APP_CONFIG,
  EVENT_BUS,
  JOB_QUEUE,
  type AppConfig,
  type EventBus,
  type JobQueue,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
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
        if (!OFFICIAL_TRIGGER_CONTENT_TYPES.has(p.contentType)) return;
        const conversation = await this.chatRead.getConversation(p.conversationId);
        if (!conversation || !isOfficialConversation(conversation)) return;
        await this.jobs.send<OfficialReplyJob>(
          OFFICIAL_REPLY_JOB,
          {
            userId: p.senderRefId,
            conversationId: p.conversationId,
            messageId: p.messageId,
            seq: p.seq,
            contentType: p.contentType,
          },
          { tx, singletonKey: `official-reply:${p.messageId}`, retryLimit: 2, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'official.on_user_registered',
      eventType: 'identity.user_registered',
      handle: async (event) => {
        const userId = event.payload.userId;
        try {
          if ((await this.accounts.getAccountStatus(userId)) !== 'active') return;
          await this.engine.ensureConversation(userId);
        } catch (error) {
          // 注册补齐失败不阻塞注册流程：老用户自动补走 HTTP ensure 端口兜底。
          this.logger.warn(`注册补齐官方会话失败：userId=${userId} ${(error as Error).message}`);
        }
      },
    });
    await this.jobs.work<OfficialReplyJob>(
      OFFICIAL_REPLY_JOB,
      async (job) => {
        await this.engine.answerForMessage(job.data);
      },
      { pollingIntervalSeconds: 1, localConcurrency: 2 },
    );
  }
}
