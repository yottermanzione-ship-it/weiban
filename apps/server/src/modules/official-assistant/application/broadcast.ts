/**
 * 公告群发（方向 B §7.5，单独做）：以小V同学名义向显式用户列表各发一条官方消息。
 *
 * - 默认关闭（OFFICIAL_ASSISTANT_BROADCAST_ENABLED），未开启时管理员调用直接拒绝；
 * - 受众规则待定：只接受显式 userIds 列表；all_users 保留契约形状、服务端拒绝，
 * 不擅自定“全部用户/全部 PRO+”之类的规则；
 * - 每用户独立事务：账号失效跳过、单用户失败不影响其他人；逐条幂等键，去重重发只发一次；
 * - 群发消息是官方身份消息，不触发客服回复引擎（lifecycle 只认用户发来的消息），但会正常推送。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OFFICIAL_REF_ID,
  type ChatAdminPort,
  type ChatParticipantPort,
  type IdentityAccountStatusPort,
  type OfficialBroadcastRequest,
  type OfficialBroadcastResponse,
  type Tx,
} from '@weiban/contracts';
import {
  APP_CONFIG,
  AUDIT_LOG,
  DATABASE,
  AppError,
  type AppConfig,
  type AuditLog,
  type Database,
} from '../../../platform/index.js';
import { CHAT_ADMIN_PORT, CHAT_PARTICIPANT_PORT } from '../../chat/index.js';
import { IDENTITY_ACCOUNT_STATUS_PORT } from '../../identity/index.js';
import { officialParticipantOf } from '../domain/identity.js';

@Injectable()
export class OfficialBroadcastService {
  private readonly logger = new Logger(OfficialBroadcastService.name);
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CHAT_ADMIN_PORT) private readonly chatAdmin: ChatAdminPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly participants: ChatParticipantPort,
    @Inject(IDENTITY_ACCOUNT_STATUS_PORT)
    private readonly accounts: IdentityAccountStatusPort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async broadcast(
    adminId: string,
    input: OfficialBroadcastRequest,
  ): Promise<OfficialBroadcastResponse> {
    if (!this.config.officialAssistant.broadcastEnabled)
      throw new AppError('conflict', '公告群发未开启');
    if (input.audience.kind === 'all_users')
      throw new AppError('bad_request', '公告受众规则待定，暂不支持向全部用户群发');
    let delivered = 0;
    let skipped = 0;
    const text = input.title ? `\n${input.body}` : input.body;
    for (const userId of [...new Set(input.audience.userIds)]) {
      try {
        if ((await this.accounts.getAccountStatus(userId)) !== 'active') {
          skipped += 1;
          continue;
        }
        await this.database.transaction(async (tx) => {
          const conversation = await this.chatAdmin.ensureOfficialConversation(tx as Tx, {
            userId,
          });
          const official = officialParticipantOf(conversation);
          if (!official || official.refId !== OFFICIAL_REF_ID)
            throw new AppError('internal_error', '官方会话缺少官方参与者');
          const posted = await this.participants.postMessage(
            {
              conversationId: conversation.conversationId,
              senderParticipantId: official.participantId,
              content: { type: 'text', text },
              idempotencyKey: `official:broadcast:${input.broadcastId}:${userId}`,
            },
            tx as Tx,
          );
          if (!posted.ok) throw new AppError('internal_error', posted.message ?? '公告未能发出');
        });
        delivered += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `公告群发跳过用户：broadcastId=${input.broadcastId} userId=${userId} ${(error as Error).message}`,
        );
      }
    }
    await this.audit.record({
      module: 'official-assistant',
      action: 'official.broadcast',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'official_broadcast',
      targetId: input.broadcastId,
      details: { delivered, skipped, audienceKind: input.audience.kind },
    });
    return { broadcastId: input.broadcastId, delivered, skipped };
  }
}
