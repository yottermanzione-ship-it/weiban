import { Inject, Injectable, type OnModuleInit, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { type ChatReadPort, type ContactsReadPort } from '@weiban/contracts';
import {
  EVENT_BUS,
  JOB_QUEUE,
  USER_DATA_REGISTRY,
  type EventBus,
  type JobQueue,
  type UserDataRegistry,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { companionSettings, replyPlans } from '../infra/db/schema.js';
import { GENERATE_REPLY_JOB, ReplyPlanStore } from './plan-store.js';
import { ReplyEngine } from './reply-engine.js';
@Injectable()
export class AiRuntimeLifecycle implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyEngine) readonly engine: ReplyEngine,
    @Inject(EVENT_BUS) readonly bus: EventBus,
    @Inject(JOB_QUEUE) readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) readonly registry: UserDataRegistry,
    @Inject(CHAT_READ_PORT) readonly chat: ChatReadPort,
    @Inject(CONTACTS_READ_PORT) readonly contacts: ContactsReadPort,
  ) {}
  async onApplicationBootstrap(): Promise<void> {
    if (this.jobs.isReady)
      await this.jobs.send('ai.reconcile', {}, { retryLimit: 10, retryBackoff: true });
  }
  async onModuleInit(): Promise<void> {
    this.registry.register({
      module: 'ai_runtime',
      purgeUser: (id) => this.store.purgeUser(id),
      countUserData: (id) => this.store.countUserData(id),
    });
    await this.jobs.work<{ planId: string }>(
      GENERATE_REPLY_JOB,
      (j) => this.engine.run(j.data.planId),
      { pollingIntervalSeconds: 0.5, localConcurrency: 4 },
    );
    await this.jobs.work<{ userId?: string }>('ai.recover_replies', (job) =>
      this.store.recover(job.data.userId),
    );
    await this.jobs.work('ai.reconcile', () => this.store.reconcile());
    await this.jobs.schedule('ai.reconcile', '* * * * *');
    this.bus.subscribe({
      consumer: 'ai.on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        if (!role) return;
        await this.store.enqueue(tx, {
          userId: p.senderRefId,
          characterId: role.refId,
          conversationId: p.conversationId,
          triggerId: p.messageId,
          triggerSeq: p.seq,
          kind: 'message',
          triggeredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async (event, tx) => {
        await this.store.enqueue(tx, {
          ...event.payload,
          triggerId: event.eventId,
          triggerSeq: 0,
          kind: 'greeting',
          triggeredAt: event.occurredAt,
        });
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_removed',
      eventType: 'contacts.contact_removed',
      handle: async (event, tx) => {
        const { userId, characterId } = event.payload;
        if (await this.contacts.getActiveContact(userId, characterId)) return;
        await this.store.lock(tx, userId);
        await tx.db
          .update(replyPlans)
          .set({
            status: 'cancelled',
            inputCiphertext: null,
            resultCiphertext: null,
            leaseId: null,
            leaseUntil: null,
          })
          .where(
            and(
              eq(replyPlans.userId, userId),
              eq(replyPlans.characterId, characterId),
              inArray(replyPlans.status, ['queued', 'generating', 'waiting', 'sending']),
            ),
          );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId, conversationId } = event.payload;
        await this.store.lock(tx, userId);
        if (conversationId)
          await tx.db
            .delete(replyPlans)
            .where(
              and(eq(replyPlans.userId, userId), eq(replyPlans.conversationId, conversationId)),
            );
        if (!(await this.contacts.getActiveContact(userId, characterId)))
          await tx.db
            .delete(companionSettings)
            .where(
              and(
                eq(companionSettings.userId, userId),
                eq(companionSettings.characterId, characterId),
              ),
            );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_balance_restored',
      eventType: 'billing.balance_restored',
      handle: async (event, tx) => {
        await this.jobs.send(
          'ai.recover_replies',
          { userId: event.payload.userId },
          { tx, retryLimit: 10, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_model_recovered',
      eventType: 'model_access.model_status_changed',
      handle: async (event, tx) => {
        if (event.payload.available)
          await this.jobs.send(
            'ai.recover_replies',
            {},
            { tx, retryLimit: 10, retryBackoff: true },
          );
      },
    });
  }
}
