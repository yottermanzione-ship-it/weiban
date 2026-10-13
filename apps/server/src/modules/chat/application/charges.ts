/**
 * v3.3（积分制，ADR-0032）：积分明细「每条消息」页——按调用（用量记录 ID）查对应消息的摘要与消耗积分。
 * 只返回当前用户自己会话里的消息；成人范围、撤回、非文字消息的摘要一律为「[消息]」。
 */
import { Inject, Injectable } from '@nestjs/common';
import { microsToPoints, type ChargedMessage } from '@weiban/contracts';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DATABASE, type Database } from '../../../platform/index.js';
import { conversations, messages } from '../infra/db/schema.js';
import { ChatStore } from './store.js';

const EXCERPT_CHARS = 30;

@Injectable()
export class ChatChargeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ChatStore) private readonly store: ChatStore,
  ) {}

  async byUsage(userId: string, usageRecordIds: string[]): Promise<{ items: ChargedMessage[] }> {
    const ids = [...new Set(usageRecordIds)];
    return this.db.transaction(async (tx) => {
      await this.store.requireActive(tx, userId);
      const rows = await tx.db
        .select({ message: messages, conversation: conversations })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            eq(conversations.ownerUserId, userId),
            isNotNull(messages.usageRecordId),
            inArray(messages.usageRecordId, ids),
          ),
        );
      const items: ChargedMessage[] = [];
      for (const { message, conversation } of rows) {
        let excerpt = '[消息]';
        if (message.scope === 'normal' && message.status !== 'recalled') {
          const content = await this.store.content(tx, conversation, message).catch(() => null);
          if (content?.type === 'text')
            excerpt = [...content.text].slice(0, EXCERPT_CHARS).join('') || '[消息]';
        }
        items.push({
          usageRecordId: message.usageRecordId!,
          messageId: message.id,
          conversationId: message.conversationId,
          excerpt,
          pointsCost: microsToPoints(message.chargedMicros ?? 0),
          createdAt: message.createdAt.toISOString(),
        });
      }
      return { items };
    });
  }
}
