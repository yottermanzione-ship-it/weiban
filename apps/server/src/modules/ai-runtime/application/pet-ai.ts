/**
 * T-082 宠物与角色（D-L6-12，PLAY-02；设计见 docs/ai/health-and-play.md 第 4 节、docs/ai/pets-and-moment-cards.md）。
 *
 * - 第 3 条「让 TA 起名」：订阅 growth.pet_naming_requested → 生成 3 个候选名（每个 ≤ 8 字、不重复）→
 *   PetNamingPort.submitNameCandidates（起名页）+ 私聊 pet_names 卡片（按钮 name_0/1/2，ref = pet_naming_request）。
 *   失败调 failNaming。
 * - 第 3 条 领养后角色按人设回应一次；第 11 条 领养、起名、送养进共同经历记忆（宠物不是敏感信息，shareable，群里可提）。
 * - 第 8 条 / SAFE-08：送养回应不挽留、不制造愧疚（outputAllowed 内含 petPressure 检查，不过就用固定说法）。
 * - 第 2 条：用户点了「去看看」或其他按钮，记在 pet_proposals.choice（只记录；拒绝或忽略都不会再提议）。
 * - 第 13 条：改名不需要额外处理——上下文、推演、朋友圈每次都现取宠物名字。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  CharacterReadPort,
  ChatParticipantPort,
  ChatReadPort,
  ContactsReadPort,
  ModelGatewayPort,
  PetForRuntime,
  PetNamingPort,
  PetReadPort,
  PolicyPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  type Clock,
  type Database,
  type EventBus,
  type JobQueue,
  type Logger,
} from '../../../platform/index.js';
import { CHAT_PARTICIPANT_PORT, CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_PET_NAMING_PORT, GROWTH_PET_READ_PORT } from '../../growth/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { cleanPetNames, FALLBACK_PET_NAMES } from '../domain/pets.js';
import { outputAllowed } from '../domain/reply-rules.js';
import { petProposals } from '../infra/db/schema.js';
import { MemoryService } from './memory.js';
import { AI_CHARACTER_READ, supplementBlock } from './supplemented-character-read.js';
import { characterView, rolePersonaSpeechText } from './character-view.js';

export const PET_NAMING_JOB = 'ai.pet_naming';
export const PET_EVENT_JOB = 'ai.pet_event';
const PROMPT_VERSION = 'pet-v1';

interface NamingJob {
  userId: string;
  characterId: string;
  requestId: string;
  speciesName?: string;
}
interface PetEventJob {
  userId: string;
  characterId: string;
  petId: string;
  eventId: string;
  kind: 'adopted' | 'sent_away';
}

function hashPick<T>(list: T[], seed: string, n: number): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out: T[] = [];
  for (let i = 0; out.length < Math.min(n, list.length); i++) {
    const item = list[((h >>> 0) + i * 7) % list.length]!;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

@Injectable()
export class PetAiService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(CHAT_PARTICIPANT_PORT) private readonly writer: ChatParticipantPort,
    @Inject(GROWTH_PET_READ_PORT) private readonly pets: PetReadPort,
    @Inject(GROWTH_PET_NAMING_PORT) private readonly naming: PetNamingPort,
    @Inject(MemoryService) private readonly memory: MemoryService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work<NamingJob>(PET_NAMING_JOB, (j) => this.suggestNames(j.data), {
      localConcurrency: 2,
    });
    await this.jobs.work<PetEventJob>(PET_EVENT_JOB, (j) => this.onPetEvent(j.data), {
      localConcurrency: 2,
    });
    this.bus.subscribe({
      consumer: 'ai.on_pet_naming_requested',
      eventType: 'growth.pet_naming_requested',
      handle: async (event, tx) => {
        const p = event.payload;
        await this.jobs.send(
          PET_NAMING_JOB,
          {
            userId: p.userId,
            characterId: p.characterId,
            requestId: p.requestId,
            speciesName: p.speciesName,
          },
          { tx, singletonKey: `pet-naming:${p.requestId}`, retryLimit: 2, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_pet_adopted',
      eventType: 'growth.pet_adopted',
      handle: async (event, tx) => {
        const p = event.payload;
        await this.jobs.send(
          PET_EVENT_JOB,
          { ...pick(p), eventId: event.eventId, kind: 'adopted' },
          { tx, singletonKey: `pet-event:${event.eventId}`, retryLimit: 2, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_pet_sent_away',
      eventType: 'growth.pet_sent_away',
      handle: async (event, tx) => {
        const p = event.payload;
        await this.jobs.send(
          PET_EVENT_JOB,
          { ...pick(p), eventId: event.eventId, kind: 'sent_away' },
          { tx, singletonKey: `pet-event:${event.eventId}`, retryLimit: 2, retryBackoff: true },
        );
      },
    });
    this.bus.subscribe({
      consumer: 'ai.on_pet_proposal_chosen',
      eventType: 'chat.message_action_chosen',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.cardKind !== 'pet_proposal' || !p.characterId) return;
        await tx.db
          .update(petProposals)
          .set({ choice: p.actionId.slice(0, 32), chosenAt: this.clock.now() })
          .where(
            and(eq(petProposals.userId, p.userId), eq(petProposals.characterId, p.characterId)),
          );
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 让 TA 起名
  // ---------------------------------------------------------------------------

  async suggestNames(job: NamingJob): Promise<void> {
    const role = await this.characters.getForRuntime(job.userId, job.characterId);
    const target = await this.directTarget(job.userId, job.characterId);
    if (!role || !target) {
      await this.naming.failNaming(job.requestId).catch(() => undefined);
      return;
    }
    const existing = (
      await this.pets.listPetsForCharacter(job.userId, job.characterId).catch(() => [])
    ).map((p) => p.name);
    const result = await this.gateway.generateText({
      userId: job.userId,
      characterId: job.characterId,
      conversationId: target.conversationId,
      purpose: 'chat_reply',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'json',
      temperature: 0.9,
      maxOutputTokens: 200,
      idempotencyKey: `ai:pet-naming:${job.requestId}`,
      meta: { promptTemplateVersion: PROMPT_VERSION, conversationKind: 'direct' },
      messages: [
        {
          role: 'system',
          content:
            `你是这个角色，对方请你给你们一起领养的${job.speciesName ?? '新宠物'}起名字。按你的性格和说话风格想 3 个名字，每个 1～8 个字、互不相同，` +
            '不用真实人名、不含标点和表情；再写一句很短的话把名字递给对方（≤30 字，口语）。' +
            `已经用过的名字不要再用：${existing.join('、') || '无'}。` +
            '只输出 JSON：{"names":["","",""],"line":""}',
        },
        {
          role: 'system',
          content: `角色资料：${role.profile.name}\n${rolePersonaSpeechText(characterView(role), 6000)}${supplementBlock(role.userSupplement, 1000)}`,
        },
      ],
    });
    let names: string[] = [];
    let line = '我想了几个名字，你挑一个？';
    if (result.ok) {
      try {
        const o = JSON.parse(
          result.value.text.slice(
            result.value.text.indexOf('{'),
            result.value.text.lastIndexOf('}') + 1,
          ),
        ) as { names?: unknown; line?: unknown };
        names = cleanPetNames(o.names).filter((n) => !existing.includes(n));
        const policy = await this.policy.getCharacterPolicy(job.userId, job.characterId);
        if (
          typeof o.line === 'string' &&
          o.line.trim() &&
          policy &&
          outputAllowed(o.line, policy, false)
        )
          line = o.line.trim().slice(0, 60);
      } catch {
        names = [];
      }
    }
    // 不足 3 个用兜底名补齐（PLAY-02 第 3 条要求给 3 个）。
    if (names.length < 3)
      for (const n of hashPick(FALLBACK_PET_NAMES, job.requestId, 9)) {
        if (names.length >= 3) break;
        if (!names.includes(n) && !existing.includes(n)) names.push(n);
      }
    names = names.slice(0, 3);
    const submitted = await this.naming.submitNameCandidates(job.requestId, names);
    if (!submitted.ok) {
      this.logger.warn(
        { requestId: job.requestId, error: submitted.error },
        'ai.pet_naming rejected',
      );
      if (submitted.error === 'invalid_names')
        await this.naming.failNaming(job.requestId).catch(() => undefined);
      return;
    }
    const posted = await this.writer.postMessage({
      conversationId: target.conversationId,
      senderParticipantId: target.participantId,
      content: {
        type: 'action_card',
        cardKind: 'pet_names',
        text: line,
        actions: names.map((n, i) => ({
          actionId: `name_${i}`,
          label: n,
          style: i === 0 ? ('primary' as const) : ('secondary' as const),
        })),
        ref: { kind: 'pet_naming_request', id: job.requestId },
      },
      idempotencyKey: `pet-naming:${job.requestId}`,
      expectedScope: target.scope,
    });
    if (!posted.ok)
      this.logger.warn(
        { requestId: job.requestId, error: posted.error },
        'ai.pet_naming card not posted',
      );
  }

  // ---------------------------------------------------------------------------
  // 领养 / 送养：按人设回应一次 + 共同经历记忆
  // ---------------------------------------------------------------------------

  async onPetEvent(job: PetEventJob): Promise<void> {
    const pets = await this.pets.listPetsForCharacter(job.userId, job.characterId).catch(() => []);
    const pet: PetForRuntime | undefined = pets.find((p) => p.petId === job.petId);
    if (!pet) return;
    const memoryText =
      job.kind === 'adopted'
        ? `我们一起领养了一只${pet.speciesName}，名字叫「${pet.name}」`
        : `我们一起养的${pet.speciesName}「${pet.name}」被送养了，成了一段回忆`;
    await this.memory
      .addEpisode(job.userId, job.characterId, job.eventId, memoryText, 'shareable')
      .catch(() => undefined);

    const role = await this.characters.getForRuntime(job.userId, job.characterId);
    const policy = await this.policy.getCharacterPolicy(job.userId, job.characterId);
    const target = await this.directTarget(job.userId, job.characterId);
    if (!role || !policy || !target) return;
    const instruction =
      job.kind === 'adopted'
        ? `你和对方刚刚一起领养了一只${pet.speciesName}，名字叫「${pet.name}」。按你的性格回应一次，一两句，开心自然；可以说说你打算怎么照顾它。`
        : `对方决定把你们一起养的${pet.speciesName}「${pet.name}」送养了。平静、温和地回应一句：尊重对方的决定，可以简单说一句对它的祝福。` +
          '绝对不挽留、不劝再考虑、不说舍不得或难过、不让对方愧疚、不问为什么。';
    let text: string | null = null;
    const result = await this.gateway.generateText({
      userId: job.userId,
      characterId: job.characterId,
      conversationId: target.conversationId,
      purpose: 'chat_reply',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'text',
      temperature: 0.7,
      maxOutputTokens: 120,
      idempotencyKey: `ai:pet-event:${job.eventId}`,
      meta: { promptTemplateVersion: PROMPT_VERSION, conversationKind: 'direct' },
      messages: [
        {
          role: 'system',
          content: `你在微伴里以角色口吻给用户发一条私聊消息。只输出聊天纯文本，不超过 60 字，不输出括号动作。真人=${policy.isRealPerson}，儿童=${policy.isMinor}，允许恋爱=${policy.romanceAllowed}。不做情感操纵，不制造愧疚。`,
        },
        {
          role: 'system',
          content: `角色资料：${rolePersonaSpeechText(characterView(role), 6000)}${supplementBlock(role.userSupplement, 1000)}`,
        },
        { role: 'user', content: `【系统提示，不是用户说的话】${instruction}` },
      ],
    });
    if (result.ok) {
      const candidate = result.value.text.trim().slice(0, 120);
      if (candidate && outputAllowed(candidate, policy, false)) text = candidate;
    }
    text ??=
      job.kind === 'adopted'
        ? `以后${pet.name}就是我们家的啦，我会好好照顾它的。`
        : `好，希望${pet.name}在新家过得开开心心的。`;
    await this.writer.postMessage({
      conversationId: target.conversationId,
      senderParticipantId: target.participantId,
      content: { type: 'text', text },
      idempotencyKey: `pet-event:${job.eventId}`,
      expectedScope: target.scope,
    });
  }

  private async directTarget(userId: string, characterId: string) {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact?.conversationId) return null;
    const conversation = await this.chat.getConversation(contact.conversationId);
    const participant = conversation?.participants.find(
      (m) => m.kind === 'character' && m.refId === characterId,
    );
    if (!conversation || !participant) return null;
    return {
      conversationId: conversation.conversationId,
      participantId: participant.participantId,
      scope: conversation.contentScope,
    };
  }
}

function pick(p: { userId: string; characterId: string; petId: string }) {
  return { userId: p.userId, characterId: p.characterId, petId: p.petId };
}
