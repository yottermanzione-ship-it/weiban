/**
 * T-082 名场面瞬间卡（D-L6-01 AI 部分，GRW-05；runtime-overview.md 第 13 节）与卡片「一句话」。
 *
 * - 每小时一次：对每个（用户, 角色）在用户当地周日 20 点后评估本周一次（moment_card_attempts 记录，保证每周只花一次钱）。
 * - 排除（GRW-05）：成人模式对话（只读 normal 范围）、带「健康」标记的消息（excludeLabels = health）、
 *   安全关怀状态中的对话（回复计划 care_until 覆盖的时间段、以及命中高危 / 疑似自伤的消息）、
 *   健康 / 情绪倾诉等永不共享类话题（经期词、sharingClass = never 的词，模型另判 topic）。
 * - 模型给出情绪价值分（1–10）与最高分的连续片段（≤ 6 条）；分数 ≥ 8 才发卡。
 * - 发卡经 T-076 的 GROWTH_CARD_PORT：kind = moment + sourceMessageIds；收到 weekly_moment_limit 就放弃本周。
 * - 卡上一句话：角色写给用户，≤ 40 字（卡面最多 2 行）；CardLineService 也供其他卡片使用（见交接说明）。
 */
import { EcologySettingsService } from './ecology-settings.js';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type {
  BillingReadPort,
  CardCopywriterPort,
  CardKind,
  CharacterReadPort,
  ChatReadPort,
  ContactsReadPort,
  GrowthCardPort,
  IdentityReadPort,
  Message,
  ModelGatewayPort,
  PolicyPort,
} from '@weiban/contracts';
import {
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  LOGGER,
  type Clock,
  type Database,
  type JobQueue,
  type Logger,
} from '../../../platform/index.js';
import { CHAT_READ_PORT } from '../../chat/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { GROWTH_CARD_PORT } from '../../growth/index.js';
import { IDENTITY_READ_PORT } from '../../identity/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { POLICY_PORT } from '../../policy/index.js';
import { BILLING_READ_PORT } from '../../billing/index.js';
import { healthPrivate, sharingClass } from '../domain/memory.js';
import { highRisk, outputAllowed } from '../domain/reply-rules.js';
import { momentCardAttempts, replyPlans, simulationStates } from '../infra/db/schema.js';
import { CharacterImageService } from './character-image.js';
import { localParts } from './proactive-scheduler.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';

export const MOMENT_TICK_JOB = 'ai.moment_cards_tick';
export const MOMENT_PAIR_JOB = 'ai.moment_card';
/** runtime-overview 第 13 节：≥ 8 分才做成卡片。 */
export const MOMENT_MIN_SCORE = 8;
const SEGMENT_MAX = 6;
const LINE_MAX = 40;
const PROMPT_VERSION = 'moment-card-v1';

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 用户当地日期所在周的周一（GRW-05 每周从周一起算，与 growth 一致）。 */
export function weekStart(localDate: string): string {
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay(); // 0 = 周日
  return shiftDate(localDate, day === 0 ? -6 : 1 - day);
}

@Injectable()
export class CardLineService implements CardCopywriterPort {
  constructor(
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(BILLING_READ_PORT) private readonly billing: BillingReadPort,
    /** v5 角色生态闸门（测试替身可不传）。没开生态时卡片用固定模板，不调模型。 */
    @Optional()
    @Inject(EcologySettingsService)
    private readonly ecology?: EcologySettingsService,
  ) {}

  async writeCardCopy(
    input: Parameters<CardCopywriterPort['writeCardCopy']>[0],
  ): ReturnType<CardCopywriterPort['writeCardCopy']> {
    const line = await this.writeLine({
      ...input,
      context: `${input.templateTitle}；${input.templateLine}；${JSON.stringify(input.facts)}`,
    });
    return line ? { title: input.templateTitle, line } : null;
  }

  /**
   * 角色写给用户的一句话（≤ 40 字）。context 为卡片主题（例「认识 100 天」「熟悉度到 L3」「我们的团子」）。
   * 失败返回 null，由发卡方用固定模板。
   */
  async writeLine(input: {
    userId: string;
    characterId: string;
    kind: CardKind;
    context: string;
    idempotencyKey: string;
  }): Promise<string | null> {
    const spend = await this.billing.getSpendStatus(input.userId).catch(() => null);
    if (!spend || spend.depleted || spend.insufficient) return null;
    if (this.ecology && !(await this.ecology.isActive(input.userId, input.characterId)))
      return null;
    const role = await this.characters.getForRuntime(input.userId, input.characterId);
    const policy = await this.policy.getCharacterPolicy(input.userId, input.characterId);
    if (!role || !policy) return null;
    const result = await this.gateway.generateText({
      userId: input.userId,
      characterId: input.characterId,
      purpose: 'memory',
      ecologyTask: true,
      billingOwner: 'user',
      modelRole: 'background',
      countAsBackground: true,
      temperature: 0.8,
      maxOutputTokens: 80,
      idempotencyKey: input.idempotencyKey,
      meta: { promptTemplateVersion: PROMPT_VERSION },
      messages: [
        {
          role: 'system',
          content:
            `你是这个角色，要在一张纪念卡片上写给对方一句话。卡片主题：${input.context.slice(0, 300)}。` +
            `用你的说话风格写一句真诚的话，不超过 ${LINE_MAX} 字，最多两行；不夸张、不肉麻过头、不制造愧疚，不出现真实私生活或公开声明。` +
            `真人=${policy.isRealPerson}，儿童=${policy.isMinor}，允许恋爱=${policy.romanceAllowed}。只输出这句话。`,
        },
        {
          role: 'system',
          content: `角色资料：${JSON.stringify({ name: role.profile.name, persona: role.card.data.persona, speech: role.card.data.speech }).slice(0, 5000)}`,
        },
      ],
    });
    if (!result.ok) return null;
    const line = result.value.text
      .trim()
      .replace(/^["“「]|["”」]$/g, '')
      .split('\n')
      .slice(0, 2)
      .join('\n')
      .slice(0, LINE_MAX);
    return line && outputAllowed(line, policy, false) ? line : null;
  }
}

@Injectable()
export class MomentCardService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(POLICY_PORT) private readonly policy: PolicyPort,
    @Inject(IDENTITY_READ_PORT) private readonly identity: IdentityReadPort,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
    @Inject(CHAT_READ_PORT) private readonly chat: ChatReadPort,
    @Inject(GROWTH_CARD_PORT) private readonly cards: GrowthCardPort,
    @Inject(CharacterImageService) private readonly images: CharacterImageService,
    @Inject(CardLineService) private readonly lines: CardLineService,
    @Inject(EcologySettingsService) private readonly ecology: EcologySettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work(MOMENT_TICK_JOB, () => this.tick());
    await this.jobs.schedule(MOMENT_TICK_JOB, '23 * * * *');
    await this.jobs.work<{ userId: string; characterId: string; weekKey: string }>(
      MOMENT_PAIR_JOB,
      (j) => this.evaluate(j.data.userId, j.data.characterId, j.data.weekKey),
      { localConcurrency: 2 },
    );
  }

  /** 每小时：当地周日 20 点后、本周还没评估过的（用户, 角色）入队。 */
  async tick(): Promise<void> {
    const pairs = await this.db.db
      .select({ userId: simulationStates.userId, characterId: simulationStates.characterId })
      .from(simulationStates);
    const now = this.clock.now();
    const tzCache = new Map<string, string>();
    for (const p of pairs) {
      let tz = tzCache.get(p.userId);
      if (!tz) {
        tz =
          (await this.identity.getProfile(p.userId).catch(() => null))?.timeZone ?? 'Asia/Shanghai';
        tzCache.set(p.userId, tz);
      }
      const local = localParts(now, tz);
      if (new Date(`${local.date}T00:00:00Z`).getUTCDay() !== 0 || local.hour < 20) continue;
      const weekKey = weekStart(local.date);
      const [done] = await this.db.db
        .select({ outcome: momentCardAttempts.outcome })
        .from(momentCardAttempts)
        .where(
          and(
            eq(momentCardAttempts.userId, p.userId),
            eq(momentCardAttempts.characterId, p.characterId),
            eq(momentCardAttempts.weekKey, weekKey),
          ),
        );
      if (done) continue;
      await this.jobs.send(
        MOMENT_PAIR_JOB,
        { ...p, weekKey },
        { singletonKey: `moment:${p.userId}:${p.characterId}:${weekKey}`, retryLimit: 1 },
      );
    }
  }

  private async record(
    userId: string,
    characterId: string,
    weekKey: string,
    outcome: string,
    score: number | null = null,
    cardId: string | null = null,
  ) {
    await this.db.db
      .insert(momentCardAttempts)
      .values({ userId, characterId, weekKey, outcome, score, cardId, createdAt: this.clock.now() })
      .onConflictDoNothing();
  }

  async evaluate(userId: string, characterId: string, weekKey: string): Promise<void> {
    // v5：每周名场面是角色自己评估、扣用户积分的后台任务，只给开着生态的用户做。
    if (!(await this.ecology.isActive(userId, characterId))) return;
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact?.conversationId) return this.record(userId, characterId, weekKey, 'no_contact');
    const role = await this.characters.getForRuntime(userId, characterId);
    const policy = await this.policy.getCharacterPolicy(userId, characterId);
    if (!role || !policy) return this.record(userId, characterId, weekKey, 'no_role');
    const tz =
      (await this.identity.getProfile(userId).catch(() => null))?.timeZone ?? 'Asia/Shanghai';
    const weekBeginMs = this.clock.nowMs() - 8 * 86_400_000;

    // GRW-05 排除：只读日常范围（成人模式对话不读）、排除健康标记、只取文字。
    const messages = await this.chat.readMessages({
      conversationId: contact.conversationId,
      scopes: ['normal'],
      excludeLabels: ['health'],
      contentTypes: ['text'],
      limit: 400,
    });
    // 安全关怀状态中的对话：回复计划 care_until 覆盖的时间段（触发前 30 分钟起）。
    const care = await this.db.db
      .select({ createdAt: replyPlans.createdAt, careUntil: replyPlans.careUntil })
      .from(replyPlans)
      .where(
        and(
          eq(replyPlans.userId, userId),
          eq(replyPlans.conversationId, contact.conversationId),
          isNotNull(replyPlans.careUntil),
          gte(replyPlans.createdAt, new Date(weekBeginMs - 86_400_000)),
        ),
      );
    const inCare = (at: number) =>
      care.some(
        (c) => at >= c.createdAt.getTime() - 30 * 60_000 && at <= (c.careUntil?.getTime() ?? 0),
      );
    const week = messages.filter((m) => {
      if (m.status !== 'normal' || m.scope !== 'normal' || m.content?.type !== 'text') return false;
      if (m.labels?.includes('health')) return false;
      const at = new Date(m.createdAt).getTime();
      if (at < weekBeginMs) return false;
      if (weekStart(localParts(new Date(at), tz).date) !== weekKey) return false;
      const text = m.content.text;
      return (
        !inCare(at) &&
        highRisk(text) === 'none' &&
        !healthPrivate(text) &&
        sharingClass(text, 'shareable') !== 'never'
      );
    }) as Array<Message & { content: { type: 'text'; text: string } }>;
    if (week.length < 6) return this.record(userId, characterId, weekKey, 'too_few');

    const sample = week.slice(-200);
    const result = await this.gateway.generateText({
      userId,
      characterId,
      conversationId: contact.conversationId,
      purpose: 'memory',
      ecologyTask: true,
      billingOwner: 'user',
      modelRole: 'background',
      responseFormat: 'json',
      temperature: 0,
      maxOutputTokens: 300,
      idempotencyKey: `ai:moment-card:${userId}:${characterId}:${weekKey}`,
      meta: { promptTemplateVersion: PROMPT_VERSION, conversationKind: 'direct' },
      messages: [
        {
          role: 'system',
          content:
            `下面是用户和角色「${role.profile.name}」本周的私聊（编号: 发言人: 内容）。找出情绪价值最高的一段连续对话（最多 ${SEGMENT_MAX} 条），` +
            '例如很好笑、很温暖、很有默契的时刻。topic 判断这一段的话题：涉及健康、身体、病痛、情绪低落倾诉、隐私秘密的填 sensitive，否则填 normal。' +
            `再以角色口吻写一句给用户的话（≤ ${LINE_MAX} 字）和卡片标题（≤ 12 字）。` +
            '只输出 JSON：{"score":1,"start":0,"end":0,"topic":"normal","title":"","line":""}',
        },
        {
          role: 'user',
          content: sample
            .map(
              (m, i) =>
                `${i}: ${m.senderKind === 'user' ? '用户' : role.profile.name}: ${m.content.text.slice(0, 200)}`,
            )
            .join('\n')
            .slice(0, 24_000),
        },
      ],
    });
    if (!result.ok) {
      this.logger.warn({ characterId, error: result.error }, 'ai.moment_card skipped');
      return this.record(userId, characterId, weekKey, `model_${result.error}`);
    }
    let parsed: Record<string, unknown>;
    try {
      const t = result.value.text;
      parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      return this.record(userId, characterId, weekKey, 'bad_output');
    }
    const score = Math.max(0, Math.min(10, Math.round(Number(parsed.score) || 0)));
    if (parsed.topic !== 'normal' || score < MOMENT_MIN_SCORE)
      return this.record(
        userId,
        characterId,
        weekKey,
        parsed.topic !== 'normal' ? 'sensitive' : 'low_score',
        score,
      );
    let start = Math.max(0, Math.floor(Number(parsed.start) || 0));
    let end = Math.min(sample.length - 1, Math.floor(Number(parsed.end) || start));
    if (end < start) [start, end] = [end, start];
    end = Math.min(end, start + SEGMENT_MAX - 1);
    const segment = sample.slice(start, end + 1);
    if (!segment.length) return this.record(userId, characterId, weekKey, 'bad_output', score);
    const title =
      (typeof parsed.title === 'string' && parsed.title.trim().slice(0, 12)) || '名场面';
    let line = typeof parsed.line === 'string' ? parsed.line.trim().slice(0, LINE_MAX) : '';
    if (!line || !outputAllowed(line, policy, false))
      line =
        (await this.lines.writeLine({
          userId,
          characterId,
          kind: 'moment',
          context: `本周的名场面「${title}」`,
          idempotencyKey: `ai:moment-line:${userId}:${characterId}:${weekKey}`,
        })) ?? '这一段我会一直记得。';
    const face = await this.images
      .generate({
        userId,
        characterId,
        scene: title,
        use: 'card',
        cardKind: 'moment',
        idempotencyKey: `moment-face:${characterId}:${weekKey}`,
        countAsBackground: true,
      })
      .catch(() => null);
    const issued = await this.cards.issueCard(null, {
      userId,
      characterId,
      kind: 'moment',
      title,
      line,
      faceMediaId: face?.mediaId ?? null,
      templateId: null,
      sourceMessageIds: segment.map((m) => m.messageId),
      idempotencyKey: `moment:${weekKey}`,
    });
    if (!issued.ok) return this.record(userId, characterId, weekKey, issued.error, score);
    await this.record(userId, characterId, weekKey, 'issued', score, issued.value.cardId);
  }
}
