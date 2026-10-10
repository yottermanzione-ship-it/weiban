/**
 * T-081 补充设定冲突项检出（CHR-09 第 2 条）与人设版本更新摘要（CHR-10 第 4 条）。
 *
 * 冲突项写入时机（与 T-079 后端对齐）：
 * - characters 保存补充设定（手写、导入结果确认、广场应用改版）时会清空旧冲突项并发 characters.supplement_changed(saved)；
 * - 本服务订阅该事件 → 投递任务 → 读补充设定与公开资料 → 模型对比 → 经 CHARACTER_SUPPLEMENT_CONFLICTS.setConflicts 写入；
 * - 写入前再读一次补充设定，内容已变（用户又改了）就放弃本次结果，由新事件触发的任务写入，避免旧结果覆盖新文本。
 * 冲突时以公开事实为准：回复的人设提示里「我的补充设定」排在公开资料之后，且守则说明冲突以公开资料为准。
 *
 * 更新摘要：PersonaUpdateSummaryService.summarize(before, after) 先按规则比对（新增作品、新增经历等），
 * 规则说不出来时再用平台账户调一次模型。characters 发布新版本时可调用（装配见交接说明）。
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import {
  SupplementConflict,
  type CharacterCard,
  type CharacterReadPort,
  type CharacterSupplementPort,
  type ModelGatewayPort,
} from '@weiban/contracts';
import {
  EVENT_BUS,
  JOB_QUEUE,
  LOGGER,
  type EventBus,
  type JobQueue,
  type Logger,
} from '../../../platform/index.js';
import {
  CHARACTER_SUPPLEMENT_CONFLICTS,
  CHARACTER_SUPPLEMENT_PORT,
} from '../../characters/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { parseJsonObject } from './import-ai.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';

export const SUPPLEMENT_CONFLICT_JOB = 'ai.supplement_conflicts';
const PROMPT_VERSION = 'supplement-conflict-v1';

type Conflict = z.infer<typeof SupplementConflict>;
interface ConflictWriter {
  setConflicts(userId: string, characterId: string, conflicts: Conflict[]): Promise<void>;
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex');

/** 公开资料摘要（只取会和补充设定冲突的事实类字段）。 */
export function publicFacts(card: CharacterCard, name: string) {
  const d = card.data;
  return {
    name,
    summary: d.persona.summary,
    background: d.persona.background,
    occupation: d.profileExtra.occupation,
    gender: d.profileExtra.gender,
    ageDisplay: d.profileExtra.ageDisplay,
    works: (d.profileExtra.worksDetail ?? [])
      .slice(0, 40)
      .map((w) => `${w.title}（${w.year}，${w.role}）`),
    facts: d.knowledge.entries
      .filter((e) => e.confidence === 'verified' || e.confidence === 'fictionCanon' || e.constant)
      .slice(0, 80)
      .map((e) => `${e.title}：${e.content}`),
  };
}

@Injectable()
export class SupplementConflictService implements OnModuleInit {
  constructor(
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LOGGER) private readonly logger: Logger,
    @Optional()
    @Inject(CHARACTER_SUPPLEMENT_PORT)
    private readonly supplements?: CharacterSupplementPort,
    @Optional()
    @Inject(CHARACTER_SUPPLEMENT_CONFLICTS)
    private readonly writer?: ConflictWriter,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work<{ userId: string; characterId: string }>(
      SUPPLEMENT_CONFLICT_JOB,
      (j) => this.detect(j.data.userId, j.data.characterId),
      { localConcurrency: 2 },
    );
    this.bus.subscribe({
      consumer: 'ai.on_supplement_changed',
      eventType: 'characters.supplement_changed',
      handle: async (event, tx) => {
        const p = event.payload;
        if (p.action !== 'saved') return;
        await this.jobs.send(
          SUPPLEMENT_CONFLICT_JOB,
          { userId: p.userId, characterId: p.characterId },
          { tx, retryLimit: 3, retryBackoff: true },
        );
      },
    });
  }

  async detect(userId: string, characterId: string): Promise<void> {
    if (!this.supplements || !this.writer) return;
    const text = await this.supplements.getSupplement(userId, characterId);
    if (!text) return;
    const role = await this.characters.getForRuntime(userId, characterId);
    if (!role || role.profile.kind !== 'preset') return;
    const textHash = hash(text);
    const result = await this.gateway.generateText({
      userId,
      characterId,
      purpose: 'import_analysis',
      billingOwner: 'user',
      modelRole: 'background',
      responseFormat: 'json',
      temperature: 0,
      maxOutputTokens: 1200,
      idempotencyKey: `ai:supplement-conflict:${userId}:${characterId}:${textHash.slice(0, 32)}`,
      meta: { promptTemplateVersion: PROMPT_VERSION, personaVersion: role.personaVersion },
      messages: [
        {
          role: 'system',
          content:
            '对比角色的公开资料与用户写的补充设定，找出补充设定中与公开资料明确矛盾的事实（如年龄、职业、作品、经历、关系）。' +
            '风格偏好、相处方式、公开资料没提到的细节都不算冲突。field 用简短中文名（≤10 字）。' +
            '只输出 JSON：{"conflicts":[{"field":"","publicValue":"","supplementValue":""}]}，没有冲突返回空数组。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            publicFacts: publicFacts(role.card, role.profile.name),
            supplement: text.slice(0, 5000),
          }).slice(0, 30_000),
        },
      ],
    });
    if (!result.ok) {
      this.logger.warn({ characterId, error: result.error }, 'ai.supplement_conflicts skipped');
      return;
    }
    const raw = parseJsonObject(result.value.text)?.conflicts;
    const conflicts: Conflict[] = [];
    if (Array.isArray(raw)) {
      for (const item of raw.slice(0, 50)) {
        const r = (item ?? {}) as Record<string, unknown>;
        const parsed = SupplementConflict.safeParse({
          field: typeof r.field === 'string' ? r.field.slice(0, 32) : '',
          publicValue: typeof r.publicValue === 'string' ? r.publicValue.slice(0, 200) : '',
          supplementValue:
            typeof r.supplementValue === 'string' ? r.supplementValue.slice(0, 200) : '',
        });
        if (parsed.success && parsed.data.field && parsed.data.supplementValue)
          conflicts.push(parsed.data);
      }
    }
    // 期间用户又改了补充设定：放弃本次结果（新事件会再触发）。
    const latest = await this.supplements.getSupplement(userId, characterId);
    if (!latest || hash(latest) !== textHash) return;
    await this.writer.setConflicts(userId, characterId, conflicts);
  }
}

// ---------------------------------------------------------------------------
// 人设版本更新摘要（CHR-10 第 4 条）
// ---------------------------------------------------------------------------

/** 规则比对：说得出具体变化就直接用，不花钱。返回 null 表示规则说不出来。 */
export function ruleSummary(before: CharacterCard | null, after: CharacterCard): string | null {
  if (!before) return '首次发布';
  const parts: string[] = [];
  const oldWorks = new Set((before.data.profileExtra.worksDetail ?? []).map((w) => w.title));
  const newWorks = (after.data.profileExtra.worksDetail ?? [])
    .map((w) => w.title)
    .filter((t) => !oldWorks.has(t));
  if (newWorks.length)
    parts.push(
      `新增作品${newWorks
        .slice(0, 3)
        .map((t) => `《${t.replace(/[《》]/g, '')}》`)
        .join('')}`,
    );
  const oldEntries = new Set(before.data.knowledge.entries.map((e) => e.id));
  const added = after.data.knowledge.entries.filter((e) => !oldEntries.has(e.id));
  const exp = added.filter((e) => e.category === 'experience' || e.category === 'work');
  if (exp.length)
    parts.push(
      `新增经历「${exp[0]!.title.slice(0, 20)}」${exp.length > 1 ? `等 ${exp.length} 条` : ''}`,
    );
  else if (added.length) parts.push(`补充资料 ${added.length} 条`);
  if (before.data.profileExtra.occupation !== after.data.profileExtra.occupation)
    parts.push(`职业更新为「${after.data.profileExtra.occupation.slice(0, 20)}」`);
  if (JSON.stringify(before.data.speech) !== JSON.stringify(after.data.speech))
    parts.push('调整了说话方式');
  if (JSON.stringify(before.data.persona) !== JSON.stringify(after.data.persona) && !parts.length)
    parts.push('调整了性格描述');
  return parts.length ? parts.join('；').slice(0, 200) : null;
}

@Injectable()
export class PersonaUpdateSummaryService {
  constructor(@Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort) {}

  /** 生成一句更新摘要（≤ 200 字）。adminId 为发布的管理员（平台账户计费）。 */
  async summarize(input: {
    adminId: string;
    characterId: string;
    before: CharacterCard | null;
    after: CharacterCard;
    version: number;
  }): Promise<string> {
    const rule = ruleSummary(input.before, input.after);
    if (rule) return rule;
    const result = await this.gateway.generateText({
      userId: input.adminId,
      purpose: 'admin_persona_check',
      billingOwner: 'platform',
      modelRole: 'background',
      temperature: 0.2,
      maxOutputTokens: 80,
      idempotencyKey: `ai:persona-summary:${input.characterId}:${input.version}`,
      messages: [
        {
          role: 'system',
          content:
            '比较角色资料的旧版本和新版本，用一句不超过 30 字的中文概括主要变化，例「新增作品《XX》」「补充了早年经历」。只输出这句话。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            before: input.before?.data ?? null,
            after: input.after.data,
          }).slice(0, 30_000),
        },
      ],
    });
    return result.ok && result.value.text.trim()
      ? result.value.text.trim().slice(0, 200)
      : '资料已更新';
  }
}
