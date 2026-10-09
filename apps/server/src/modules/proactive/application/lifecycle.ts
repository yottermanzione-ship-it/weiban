import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ChatReadPort, ContactsReadPort } from '@weiban/contracts';
import { and, eq, count } from 'drizzle-orm';
import {
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type Database,
  type DbTx,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { dailyEvents, proactivePendingReply, proactiveSentLog } from '../infra/db/schema.js';
import { ProactiveGuards } from './guards.js';
import { DailyEventService } from './daily-event.service.js';
import { ProactiveMessageService } from './proactive-message.service.js';

@Injectable()
export class ProactiveLifecycle implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(ProactiveGuards) private readonly guards: ProactiveGuards,
    @Inject(DailyEventService) private readonly events: DailyEventService,
    @Inject(ProactiveMessageService) private readonly messages: ProactiveMessageService,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'proactive',
      purgeUser: (id) => this.purgeUser(id),
      countUserData: (id) => this.countUserData(id),
    });
    await this.jobs.work('proactive.prune_daily_events', async () => {
      await this.events.pruneOldEvents();
    });
    await this.jobs.schedule('proactive.prune_daily_events', '30 * * * *');
    this.bus.subscribe({
      consumer: 'proactive.on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        // 普通聊天绝大多数没有主动消息待回复，避免为每条消息读取会话/账号/关系并加锁。
        const [pending] = await tx.db
          .select({ userId: proactivePendingReply.userId })
          .from(proactivePendingReply)
          .where(eq(proactivePendingReply.userId, p.senderRefId))
          .limit(1);
        if (!pending) return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const character = conversation?.participants.find((v) => v.kind === 'character');
        const user = conversation?.participants.find(
          (v) => v.kind === 'user' && v.refId === p.senderRefId,
        );
        if (!character || !user) return;
        await this.guards.lock(tx, user.refId);
        const epoch = await this.contacts.getActiveContactEpoch(user.refId, character.refId, tx);
        if (!epoch || new Date(event.occurredAt) < new Date(epoch.acceptAfter)) return;
        await this.messages.markReplied(user.refId, character.refId, tx, event.occurredAt);
      },
    });
    this.bus.subscribe({
      consumer: 'proactive.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        await this.guards.lock(tx, userId);
        if (await this.contacts.getActiveContactEpoch(userId, characterId, tx)) return;
        await this.purge(tx, userId, characterId);
      },
    });
  }
  async purgeUser(userId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.guards.lock(tx, userId);
      return this.purge(tx, userId);
    });
  }
  async countUserData(userId: string): Promise<number> {
    let total = 0;
    for (const table of [dailyEvents, proactivePendingReply, proactiveSentLog]) {
      const [row] = await this.db.db
        .select({ n: count() })
        .from(table)
        .where(eq(table.userId, userId));
      total += Number(row?.n ?? 0);
    }
    return total;
  }
  private async purge(tx: DbTx, userId: string, characterId?: string): Promise<number> {
    let total = 0;
    for (const table of [dailyEvents, proactivePendingReply, proactiveSentLog]) {
      const result = await tx.db
        .delete(table)
        .where(
          and(
            eq(table.userId, userId),
            characterId ? eq(table.characterId, characterId) : undefined,
          ),
        );
      total += result.rowCount ?? 0;
    }
    return total;
  }
}
