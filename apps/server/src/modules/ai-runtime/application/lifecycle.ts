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
import {
  companionSettings,
  replyPlans,
  memories,
  memoryStates,
  simulationStates,
  dailyEvents,
  moodStates,
} from '../infra/db/schema.js';
import { GENERATE_REPLY_JOB, ReplyPlanStore } from './plan-store.js';
import { MemoryService, EXTRACT_MEMORY_JOB, type MemoryJob } from './memory.js';
import { ReplyEngine } from './reply-engine.js';
import { invalidateReplyPlans } from './invalidate.js';
import {
  SimulationService,
  SIMULATE_CHARACTER_JOB,
  RUN_DAILY_SIMULATIONS_JOB,
} from './simulation.js';
@Injectable()
export class AiRuntimeLifecycle implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(ReplyPlanStore) readonly store: ReplyPlanStore,
    @Inject(ReplyEngine) readonly engine: ReplyEngine,
    @Inject(MemoryService) readonly memory: MemoryService,
    @Inject(SimulationService) readonly simulation: SimulationService,
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
    await this.jobs.work<MemoryJob>(EXTRACT_MEMORY_JOB, (j) => this.memory.extract(j.data), {
      pollingIntervalSeconds: 0.5,
      localConcurrency: 2,
    });
    await this.jobs.work('ai.reconcile', async () => {
      await this.store.reconcile();
      await this.memory.reconcile();
    });
    await this.jobs.schedule('ai.reconcile', '* * * * *');

    // 推演引擎（T-051）：每角色日常事件与心情
    await this.jobs.work<{ userId: string; characterId: string }>(
      SIMULATE_CHARACTER_JOB,
      (j) => this.simulation.simulateCharacter(j.data.userId, j.data.characterId),
      { pollingIntervalSeconds: 2, localConcurrency: 2 },
    );
    await this.jobs.work(RUN_DAILY_SIMULATIONS_JOB, () => this.simulation.runDailySimulations());
    // 每天凌晨 2:00（北京时间）触发推演调度
    await this.jobs.schedule(RUN_DAILY_SIMULATIONS_JOB, '0 18 * * *'); // UTC 18:00 = 北京 02:00

    this.bus.subscribe({
      consumer: 'ai.on_user_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind !== 'user' || !p.senderRefId) return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        if (!role) return;
        if (!(await this.store.lock(tx, p.senderRefId, p.conversationId))) return;
        await this.simulation.markActive(tx, p.senderRefId, role.refId);
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
      consumer: 'ai.memory_on_message',
      eventType: 'chat.message_created',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.conversationType !== 'direct' || p.senderKind === 'system') return;
        const conversation = await this.chat.getConversation(p.conversationId);
        const role = conversation?.participants.find((member) => member.kind === 'character');
        const user = conversation?.participants.find((member) => member.kind === 'user');
        if (!role || !user) return;
        const epoch = await this.contacts.getActiveContactEpoch(user.refId, role.refId);
        if (!epoch || new Date(event.occurredAt) < new Date(epoch.acceptAfter)) return;
        const message =
          p.senderKind === 'character'
            ? await this.chat.getMessage(p.messageId, ['normal', 'adult'])
            : null;
        const promise =
          message?.content?.type === 'text' &&
          /记住了|我会记住|我记下了/u.test(message.content.text);
        await this.memory.observe(
          tx,
          {
            userId: user.refId,
            characterId: role.refId,
            conversationId: p.conversationId,
            epoch: epoch.version,
          },
          p.senderKind === 'user',
          !!promise,
          p.seq,
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_accepted',
      eventType: 'contacts.contact_accepted',
      handle: async (event, tx) => {
        if (!(await this.store.lock(tx, event.payload.userId))) return;
        await this.simulation.markActive(tx, event.payload.userId, event.payload.characterId);
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
      consumer: 'ai.on_contact_context_changed',
      eventType: 'contacts.contact_updated',
      handle: async (event, tx) => {
        if (
          !event.payload.changedFields.some((field) =>
            ['relationshipType', 'addressAs'].includes(field),
          )
        )
          return;
        await this.store.lock(tx, event.payload.userId);
        await invalidateReplyPlans(tx, this.store, event.payload.userId, event.payload.characterId);
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_contact_purged',
      eventType: 'contacts.contact_purged',
      handle: async (event, tx) => {
        const { userId, characterId, conversationId } = event.payload;
        await this.store.lock(tx, userId);
        if (conversationId) {
          await tx.db
            .delete(memories)
            .where(and(eq(memories.userId, userId), eq(memories.conversationId, conversationId)));
          await tx.db
            .delete(memoryStates)
            .where(
              and(eq(memoryStates.userId, userId), eq(memoryStates.conversationId, conversationId)),
            );
        }
        if (conversationId)
          await tx.db
            .delete(replyPlans)
            .where(
              and(eq(replyPlans.userId, userId), eq(replyPlans.conversationId, conversationId)),
            );
        if (!(await this.contacts.getActiveContact(userId, characterId))) {
          await tx.db
            .delete(simulationStates)
            .where(
              and(
                eq(simulationStates.userId, userId),
                eq(simulationStates.characterId, characterId),
              ),
            );
          await tx.db
            .delete(dailyEvents)
            .where(and(eq(dailyEvents.userId, userId), eq(dailyEvents.characterId, characterId)));
          await tx.db
            .delete(moodStates)
            .where(and(eq(moodStates.userId, userId), eq(moodStates.characterId, characterId)));
          await tx.db
            .delete(companionSettings)
            .where(
              and(
                eq(companionSettings.userId, userId),
                eq(companionSettings.characterId, characterId),
              ),
            );
        }
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
