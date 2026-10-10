/**
 * T-081 导入草稿生成 AI（D-L6-04、D-L6-07 的 AI 部分），实现契约 ImportAnalyzerPort（调用方 importer）。
 * 设计说明见 docs/ai/import-analysis.md；流程依据 runtime-overview.md 第 12 节。
 *
 * - CHR-08 第 1 条：截图逐张识图，右侧气泡 = 导入者本人；相邻截图按重叠文字去重；识别结果交 importer 让用户确认。
 *   所选聊天模型不支持识图时网关改用平台默认识图模型；平台也没有时返回 vision_unavailable（入口提示更换模型）。
 * - 第 12 节第 1 条：规则识别失败时模型只看样本识别发言人。
 * - 第 12 节第 3、4 条：按约 1.2 万字分块、最多 4 块并行提取，再一次调用合并成草稿（CHR-07 同一编辑器字段）。
 * - CHR-08 第 3、4 条：草稿含名字、说话方式、口头禅、常用表情、性格总结、示例对话（原文摘取）、重要经历；
 *   分类默认「真人 · 身边真人」；识别草稿里的疑似真名供替换提示；跑儿童特征检测（检出时 childAppearance 置 true，只能更严）。
 * - CHR-09：kind = supplement 时从导入资料生成补充设定文字（≤ 5000 字）；冲突项在用户保存后由 SupplementConflictService 检出。
 * - 费用：用途 import_analysis，从用户余额扣（billingOwner = user）；不计入后台每日上限（cost-estimate.md 第 6 节）。
 * - 原文不进任何日志：本文件只记录 jobId、错误码、块数。
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  DraftCharacterCard,
  type CharacterReadPort,
  type GenerateError,
  type ImportAnalyzerPort,
  type ImportDialogueLine,
  type ImportResult,
  type ModelGatewayPort,
  type PortResult,
} from '@weiban/contracts';
import { CLOCK, LOGGER, type Clock, type Logger } from '../../../platform/index.js';
import { MODEL_GATEWAY_PORT } from '../../model-access/index.js';
import { AI_CHARACTER_READ } from './supplemented-character-read.js';

export const IMPORT_PROMPT_VERSION = 'import-v1';
/** 第 12 节第 3 条：每块约 1.2 万字，最多 4 块并行。 */
export const IMPORT_CHUNK_CHARS = 12_000;
export const IMPORT_PARALLEL = 4;
/** 截图并行识别数（网关每条消息最多 4 张图，这里一张一调，便于定位 screenshotIndex）。 */
const SCREENSHOT_PARALLEL = 4;
/** 本人一侧（右侧气泡）的发言人名。 */
export const SELF_SPEAKER = '我';
const OTHER_SPEAKER = '对方';

/**
 * 预计花费（微元）：价目表端口暂不提供「按用户所选模型报价」（见交接遗留），按 cost-estimate.md 第 5 节中档口径估算，宁高勿低。
 * 5 万字中档约 0.7 元 → 每字约 14 微元；合并与固定开销约 0.05 元；识图每张约 0.02 元（第 5 节「识图一次」上沿）。
 */
const MICROS_PER_CHAR = 14;
const MICROS_BASE = 50_000;
const MICROS_PER_SCREENSHOT = 20_000;

type Line = ImportDialogueLine;

interface ChunkExtract {
  speechTraits: string[];
  catchphrases: string[];
  emojis: string[];
  personalityClues: string[];
  selfReference: string[];
  addressUser: string[];
  examples: Array<{ context: string; reply: string }>;
  experiences: string[];
  likes: string[];
  dislikes: string[];
  realNames: string[];
  childFeatures: boolean;
}

function strArr(v: unknown, max = 30, len = 200): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);
}

function str(v: unknown, len: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, len) : undefined;
}

/** 从模型输出里取 JSON 对象（容忍代码块包裹与前后多余文字）。 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '');
}

/** 相邻截图去重：后一张开头与前一张结尾重叠的若干行去掉（按说话方与去空白文字比较）。 */
export function dedupeOverlap<T extends Line>(prev: T[], next: T[]): T[] {
  const max = Math.min(prev.length, next.length);
  for (let k = max; k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      const a = prev[prev.length - k + i]!;
      const b = next[i]!;
      if (a.speaker !== b.speaker || normalize(a.text) !== normalize(b.text)) {
        same = false;
        break;
      }
    }
    if (same) return next.slice(k);
  }
  return next;
}

/** 按字数切块（只在行边界切）。 */
export function chunkLines(lines: Line[], size = IMPORT_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let buf: string[] = [];
  let n = 0;
  for (const l of lines) {
    const row = `${l.speaker}：${l.text.replace(/\n+/g, ' ')}`;
    if (n + row.length > size && buf.length) {
      chunks.push(buf.join('\n'));
      buf = [];
      n = 0;
    }
    buf.push(row);
    n += row.length + 1;
  }
  if (buf.length) chunks.push(buf.join('\n'));
  return chunks;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 规则版儿童特征检测（与 characters/domain/child-features 口径一致的保守词表；AI 判断另行合并）。 */
const CHILD_HINTS =
  /(小学|幼儿园|初一|初二|初三|一年级|二年级|三年级|四年级|五年级|六年级|(?<!\d)(?:[6-9]|1[0-3])岁|未成年|小朋友|萝莉|正太)/u;

/** 疑似真名（2～4 个汉字，常见姓氏开头）。只做提示，不做拦截。 */
const SURNAMES =
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
export function looksLikeRealName(name: string): boolean {
  return /^[一-龥]{2,4}$/u.test(name) && SURNAMES.includes(name[0]!);
}

type AnalyzeError = 'insufficient_balance' | 'model_unavailable';

function mapError(e: GenerateError): AnalyzeError {
  return e === 'insufficient_balance' || e === 'budget_exceeded'
    ? 'insufficient_balance'
    : 'model_unavailable';
}

const SAFETY_STYLE_FALLBACK =
  '如果你现在很难受，请先联系你信任的人；也可以拨打 12356 心理援助热线，遇到危险请拨打 110 或 120。';

@Injectable()
export class ImportAiService implements ImportAnalyzerPort {
  constructor(
    @Inject(MODEL_GATEWAY_PORT) private readonly gateway: ModelGatewayPort,
    @Inject(AI_CHARACTER_READ) private readonly characters: CharacterReadPort,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  estimate(input: { userId: string; charCount: number; screenshotCount: number }): Promise<number> {
    const chars = Math.max(0, Math.min(input.charCount, 200_000));
    return Promise.resolve(
      Math.round(
        MICROS_BASE + chars * MICROS_PER_CHAR + input.screenshotCount * MICROS_PER_SCREENSHOT,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // 截图识别（D-L6-07）
  // ---------------------------------------------------------------------------

  async recognizeScreenshots(input: {
    userId: string;
    jobId: string;
    mediaIds: string[];
    idempotencyKey: string;
  }): Promise<
    PortResult<
      Array<ImportDialogueLine & { screenshotIndex: number }>,
      'insufficient_balance' | 'vision_unavailable' | 'model_unavailable'
    >
  > {
    if (!input.mediaIds.length) return { ok: true, value: [] };
    let failure: 'insufficient_balance' | 'vision_unavailable' | 'model_unavailable' | null = null;
    const perShot = await pool(
      input.mediaIds.slice(0, 30),
      SCREENSHOT_PARALLEL,
      async (mediaId, i) => {
        if (failure) return [] as Line[];
        const result = await this.gateway.generateText({
          userId: input.userId,
          purpose: 'import_analysis',
          billingOwner: 'user',
          modelRole: 'chat',
          responseFormat: 'json',
          temperature: 0,
          maxOutputTokens: 2000,
          idempotencyKey: `${input.idempotencyKey}:shot:${i}`,
          meta: { promptTemplateVersion: IMPORT_PROMPT_VERSION },
          messages: [
            {
              role: 'system',
              content:
                '你是聊天截图文字识别器。按从上到下的顺序逐条识别截图中的聊天气泡。' +
                '气泡在右侧（通常是绿色或蓝色）= 截图主人本人，side 填 right；在左侧 = 对方，side 填 left。' +
                '群聊左侧气泡上方若有昵称，填入 name；看不到昵称填 null。' +
                '忽略时间戳、系统提示、输入框、状态栏；图片 / 表情包气泡写成「[图片]」「[表情]」。' +
                '只输出 JSON：{"lines":[{"side":"left|right","name":null,"text":"..."}]}',
            },
            {
              role: 'user',
              content: '识别这张聊天截图。',
              images: [{ mediaId, ownerUserId: input.userId }],
            },
          ],
        });
        if (!result.ok) {
          failure =
            result.error === 'capability_missing' || result.error === 'not_configured'
              ? 'vision_unavailable'
              : mapError(result.error);
          return [] as Line[];
        }
        const obj = parseJsonObject(result.value.text);
        const raw = Array.isArray(obj?.lines) ? (obj.lines as unknown[]) : [];
        const lines: Line[] = [];
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const r = item as Record<string, unknown>;
          const text = str(r.text, 2000);
          if (!text) continue;
          const speaker = r.side === 'right' ? SELF_SPEAKER : (str(r.name, 40) ?? OTHER_SPEAKER);
          lines.push({
            speaker: speaker === SELF_SPEAKER && r.side !== 'right' ? OTHER_SPEAKER : speaker,
            text,
          });
        }
        return lines;
      },
    );
    if (failure) {
      this.logger.warn({ jobId: input.jobId, error: failure }, 'import.recognize failed');
      return { ok: false, error: failure };
    }
    const out: Array<Line & { screenshotIndex: number }> = [];
    let prev: Line[] = [];
    perShot.forEach((lines, index) => {
      const kept = dedupeOverlap(prev, lines);
      for (const l of kept) out.push({ ...l, screenshotIndex: index });
      prev = lines;
    });
    return { ok: true, value: out.slice(0, 5000) };
  }

  // ---------------------------------------------------------------------------
  // 规则识别失败时的发言人识别
  // ---------------------------------------------------------------------------

  async detectSpeakers(input: {
    userId: string;
    jobId: string;
    sample: string;
    idempotencyKey: string;
  }): Promise<
    PortResult<
      ImportDialogueLine[],
      'insufficient_balance' | 'model_unavailable' | 'format_unrecognized'
    >
  > {
    const sample = input.sample.slice(0, 4000);
    if (!sample.trim()) return { ok: false, error: 'format_unrecognized' };
    const result = await this.gateway.generateText({
      userId: input.userId,
      purpose: 'import_analysis',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'json',
      temperature: 0,
      maxOutputTokens: 3000,
      idempotencyKey: input.idempotencyKey,
      meta: { promptTemplateVersion: IMPORT_PROMPT_VERSION },
      messages: [
        {
          role: 'system',
          content:
            '下面是一段格式不规范的聊天记录。请判断每句话是谁说的，按原顺序拆成发言列表，内容保持原文，不改写、不补充。' +
            '发言人用记录里出现的名字；完全看不出名字时用「甲」「乙」区分。识别不出至少两个发言人时 lines 返回空数组。' +
            '只输出 JSON：{"lines":[{"speaker":"...","text":"..."}]}',
        },
        { role: 'user', content: sample },
      ],
    });
    if (!result.ok) {
      this.logger.warn({ jobId: input.jobId, error: result.error }, 'import.detect failed');
      return { ok: false, error: mapError(result.error) };
    }
    const obj = parseJsonObject(result.value.text);
    const raw = Array.isArray(obj?.lines) ? (obj.lines as unknown[]) : [];
    const lines: Line[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const speaker = str(r.speaker, 40);
      const text = str(r.text, 2000);
      if (speaker && text) lines.push({ speaker, text });
    }
    if (new Set(lines.map((l) => l.speaker)).size < 2)
      return { ok: false, error: 'format_unrecognized' };
    return { ok: true, value: lines };
  }

  // ---------------------------------------------------------------------------
  // 分析：新角色草稿 / 补充设定
  // ---------------------------------------------------------------------------

  async analyze(input: {
    userId: string;
    jobId: string;
    kind: 'new_character' | 'supplement';
    targetCharacterId: string | null;
    speaker: string;
    lines: ImportDialogueLine[];
    idempotencyKey: string;
    onProgress: (percent: number) => void;
  }): Promise<PortResult<ImportResult, AnalyzeError>> {
    const lines = input.lines.filter((l) => l.text.trim());
    if (!lines.some((l) => l.speaker === input.speaker))
      return { ok: false, error: 'model_unavailable' };
    const chunks = chunkLines(lines);
    input.onProgress(2);
    const started = this.clock.nowMs();
    if (input.kind === 'supplement') {
      if (!input.targetCharacterId) return { ok: false, error: 'model_unavailable' };
      const res = await this.buildSupplement(input, input.targetCharacterId, chunks);
      this.logger.info(
        {
          jobId: input.jobId,
          kind: input.kind,
          chunks: chunks.length,
          ms: this.clock.nowMs() - started,
          ok: res.ok,
        },
        'import.analyze done',
      );
      return res;
    }
    const res = await this.buildDraft(input, lines, chunks);
    this.logger.info(
      {
        jobId: input.jobId,
        kind: input.kind,
        chunks: chunks.length,
        ms: this.clock.nowMs() - started,
        ok: res.ok,
      },
      'import.analyze done',
    );
    return res;
  }

  private async extractChunks(
    input: {
      userId: string;
      idempotencyKey: string;
      speaker: string;
      onProgress: (p: number) => void;
    },
    chunks: string[],
  ): Promise<PortResult<ChunkExtract[], AnalyzeError>> {
    let done = 0;
    let failure: AnalyzeError | null = null;
    const results = await pool(chunks, IMPORT_PARALLEL, async (chunk, i) => {
      if (failure) return null;
      const result = await this.gateway.generateText({
        userId: input.userId,
        purpose: 'import_analysis',
        billingOwner: 'user',
        modelRole: 'chat',
        responseFormat: 'json',
        temperature: 0.2,
        maxOutputTokens: 2000,
        idempotencyKey: `${input.idempotencyKey}:chunk:${i}`,
        meta: { promptTemplateVersion: IMPORT_PROMPT_VERSION },
        messages: [
          {
            role: 'system',
            content:
              `你在分析一段聊天记录，目标人物是发言人「${input.speaker}」。只根据记录，提取目标人物的特点，不编造。` +
              '示例对话必须是原文摘取：context 是对方的一句话（可为空），reply 是目标人物的原话。' +
              'realNames 列出记录中出现的、看起来像真实姓名的人名（含目标人物自己的真名）。' +
              'childFeatures：记录显示目标人物是未成年人（如上小学 / 初中、明确不满 18 岁）时为 true。' +
              '只输出 JSON：{"speechTraits":[],"catchphrases":[],"emojis":[],"personalityClues":[],"selfReference":[],' +
              '"addressUser":[],"examples":[{"context":"","reply":""}],"experiences":[],"likes":[],"dislikes":[],' +
              '"realNames":[],"childFeatures":false}。每个数组不超过 10 项，examples 不超过 6 组。',
          },
          { role: 'user', content: chunk },
        ],
      });
      done++;
      input.onProgress(5 + Math.round((done / chunks.length) * 75));
      if (!result.ok) {
        failure = mapError(result.error);
        return null;
      }
      const o = parseJsonObject(result.value.text) ?? {};
      const examples = Array.isArray(o.examples)
        ? (o.examples as unknown[])
            .map((e) => {
              const r = (e ?? {}) as Record<string, unknown>;
              return { context: str(r.context, 300) ?? '', reply: str(r.reply, 300) ?? '' };
            })
            .filter((e) => e.reply)
            .slice(0, 6)
        : [];
      return {
        speechTraits: strArr(o.speechTraits, 10),
        catchphrases: strArr(o.catchphrases, 10, 40),
        emojis: strArr(o.emojis, 10, 20),
        personalityClues: strArr(o.personalityClues, 10),
        selfReference: strArr(o.selfReference, 5, 10),
        addressUser: strArr(o.addressUser, 5, 20),
        examples,
        experiences: strArr(o.experiences, 10, 300),
        likes: strArr(o.likes, 10, 60),
        dislikes: strArr(o.dislikes, 10, 60),
        realNames: strArr(o.realNames, 20, 40),
        childFeatures: o.childFeatures === true,
      } satisfies ChunkExtract;
    });
    if (failure) return { ok: false, error: failure };
    return { ok: true, value: results.filter((r): r is ChunkExtract => r !== null) };
  }

  private async buildDraft(
    input: Parameters<ImportAiService['analyze']>[0],
    lines: Line[],
    chunks: string[],
  ): Promise<PortResult<ImportResult, AnalyzeError>> {
    const extracted = await this.extractChunks(input, chunks);
    if (!extracted.ok) return extracted;
    const parts = extracted.value;
    const uniq = (xs: string[], max: number) => [...new Set(xs)].slice(0, max);
    const merged = {
      speechTraits: uniq(
        parts.flatMap((p) => p.speechTraits),
        30,
      ),
      catchphrases: uniq(
        parts.flatMap((p) => p.catchphrases),
        20,
      ),
      emojis: uniq(
        parts.flatMap((p) => p.emojis),
        20,
      ),
      personalityClues: uniq(
        parts.flatMap((p) => p.personalityClues),
        30,
      ),
      selfReference: uniq(
        parts.flatMap((p) => p.selfReference),
        5,
      ),
      addressUser: uniq(
        parts.flatMap((p) => p.addressUser),
        5,
      ),
      experiences: uniq(
        parts.flatMap((p) => p.experiences),
        30,
      ),
      likes: uniq(
        parts.flatMap((p) => p.likes),
        20,
      ),
      dislikes: uniq(
        parts.flatMap((p) => p.dislikes),
        20,
      ),
    };
    const examples = parts.flatMap((p) => p.examples).slice(0, 24);

    // 合并调用：整理成卡片字段（第 12 节第 4 条）。失败不致命：用规则拼装的草稿兜底。
    const mergeRes = await this.gateway.generateText({
      userId: input.userId,
      purpose: 'import_analysis',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'json',
      temperature: 0.3,
      maxOutputTokens: 2500,
      idempotencyKey: `${input.idempotencyKey}:merge`,
      meta: { promptTemplateVersion: IMPORT_PROMPT_VERSION },
      messages: [
        {
          role: 'system',
          content:
            `根据从聊天记录中提取的线索，为「${input.speaker}」整理一份角色草稿。只用线索里有的信息，不编造经历。` +
            'personaTags 从 tsundere/aloof/shy/gentle/sharpTongue/cheerful/calm/playful/airhead/mature 中选 1～3 个；' +
            'sentenceLength 取 veryShort/short/medium/long；emojiFrequency 取 none/rare/sometimes/often；' +
            'catchphraseFrequency 取 rare/sometimes/often。只输出 JSON：' +
            '{"summary":"一句话性格总结(≤100字)","personality":"性格(≤400字)","personaTags":[],"tone":"说话方式特点(≤300字)",' +
            '"sentenceLength":"short","punctuationHabit":"","catchphrases":[],"catchphraseFrequency":"sometimes",' +
            '"emojiFrequency":"sometimes","emojiFavorites":[],"selfReference":["我"],"addressUser":"","likes":[],"dislikes":[],' +
            '"experiences":[{"title":"","content":"≤200字"}],"occupation":""}',
        },
        { role: 'user', content: JSON.stringify(merged).slice(0, 20_000) },
      ],
    });
    input.onProgress(92);
    if (!mergeRes.ok && mapError(mergeRes.error) === 'insufficient_balance')
      return { ok: false, error: 'insufficient_balance' };
    const m = mergeRes.ok ? (parseJsonObject(mergeRes.value.text) ?? {}) : {};

    const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
      typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    const tags = strArr(m.personaTags, 3).filter((t) =>
      [
        'tsundere',
        'aloof',
        'shy',
        'gentle',
        'sharpTongue',
        'cheerful',
        'calm',
        'playful',
        'airhead',
        'mature',
      ].includes(t),
    );
    const avgLen =
      lines.filter((l) => l.speaker === input.speaker).reduce((n, l) => n + l.text.length, 0) /
      Math.max(1, lines.filter((l) => l.speaker === input.speaker).length);
    const sentenceLength = pick(
      m.sentenceLength,
      ['veryShort', 'short', 'medium', 'long'] as const,
      avgLen < 8 ? 'veryShort' : avgLen < 20 ? 'short' : avgLen < 50 ? 'medium' : 'long',
    );
    const experiencesRaw = Array.isArray(m.experiences)
      ? (m.experiences as unknown[]).map((e) => {
          const r = (e ?? {}) as Record<string, unknown>;
          return { title: str(r.title, 100) ?? '', content: str(r.content, 300) ?? '' };
        })
      : merged.experiences.map((c) => ({ title: c.slice(0, 20), content: c }));
    const experiences = experiencesRaw.filter((e) => e.content).slice(0, 30);

    const scenes = ['daily', 'greeting', 'teased', 'comfort', 'praised', 'lateNight'] as const;
    const cardExamples = examples.map((e, i) => ({
      id: `import-${i + 1}`,
      scene: scenes[i % scenes.length]!,
      turns: [
        ...(e.context ? [{ role: 'user' as const, text: e.context }] : []),
        { role: 'char' as const, text: e.reply },
      ],
    }));

    const summary =
      str(m.summary, 600) ?? (merged.personalityClues.slice(0, 3).join('，') || `${input.speaker}`);
    const draftInput = {
      cardSchemaVersion: 1 as const,
      data: {
        persona: {
          summary,
          personality:
            str(m.personality, 2000) ??
            (merged.personalityClues.join('；').slice(0, 2000) || summary),
          ...(tags.length ? { personaTags: tags } : {}),
          ...(strArr(m.likes, 30).length || merged.likes.length
            ? { likes: strArr(m.likes, 30).length ? strArr(m.likes, 30) : merged.likes }
            : {}),
          ...(strArr(m.dislikes, 30).length || merged.dislikes.length
            ? { dislikes: strArr(m.dislikes, 30).length ? strArr(m.dislikes, 30) : merged.dislikes }
            : {}),
        },
        speech: {
          selfReference: strArr(m.selfReference, 5, 10).length
            ? strArr(m.selfReference, 5, 10)
            : merged.selfReference.length
              ? merged.selfReference
              : ['我'],
          ...((str(m.addressUser, 200) ?? merged.addressUser[0])
            ? { addressUserDefault: str(m.addressUser, 200) ?? merged.addressUser[0] }
            : {}),
          tone: str(m.tone, 2000) ?? (merged.speechTraits.join('；').slice(0, 2000) || '自然口语'),
          sentenceLength,
          catchphrases: strArr(m.catchphrases, 20, 40).length
            ? strArr(m.catchphrases, 20, 40)
            : merged.catchphrases,
          catchphraseFrequency: pick(
            m.catchphraseFrequency,
            ['rare', 'sometimes', 'often'] as const,
            'sometimes',
          ),
          emojiHabit: {
            frequency: pick(
              m.emojiFrequency,
              ['none', 'rare', 'sometimes', 'often'] as const,
              merged.emojis.length ? 'sometimes' : 'rare',
            ),
            favorites: strArr(m.emojiFavorites, 20, 20).length
              ? strArr(m.emojiFavorites, 20, 20)
              : merged.emojis,
          },
          ...(str(m.punctuationHabit, 500)
            ? { punctuationHabit: str(m.punctuationHabit, 500) }
            : {}),
        },
        examples: cardExamples,
        knowledge: {
          entries: experiences.map((e, i) => ({
            id: `import-exp-${i + 1}`,
            title: e.title || e.content.slice(0, 20),
            category: 'experience' as const,
            keys: [e.title || e.content.slice(0, 8)].filter(Boolean),
            content: e.content.slice(0, 300),
            confidence: 'userSource' as const,
          })),
          unknownPolicy: '记录里没有提到的事不编造，自然地说不记得或换个话题。',
        },
        ...(str(m.occupation, 200)
          ? { profileExtra: { occupation: str(m.occupation, 200)! } }
          : {}),
        safetyStyle: { careFallbackText: SAFETY_STYLE_FALLBACK },
        admin: { creationMethod: 'importedChat' as const },
      },
    };
    let draft = DraftCharacterCard.safeParse(draftInput);
    if (!draft.success) {
      // 逐段丢弃不合格的部分，保证总能进编辑器。
      const data: Record<string, unknown> = { ...draftInput.data };
      for (const key of Object.keys(data)) {
        const trial = DraftCharacterCard.safeParse({
          cardSchemaVersion: 1,
          data: { [key]: data[key] },
        });
        if (!trial.success) delete data[key];
      }
      draft = DraftCharacterCard.safeParse({ cardSchemaVersion: 1, data });
      if (!draft.success) draft = DraftCharacterCard.safeParse({ cardSchemaVersion: 1, data: {} });
    }

    // 真名提示（CHR-08 第 4 条）：模型线索 + 发言人名字本身，只保留像真名的。
    const realNames = new Set<string>();
    for (const n of [input.speaker, ...parts.flatMap((p) => p.realNames)]) {
      if (looksLikeRealName(n)) realNames.add(n);
    }
    // 儿童特征检测（SAFE-03 第 4 条）：规则或模型任一命中即标记（只会更严）。
    const targetText = lines
      .filter((l) => l.speaker === input.speaker)
      .map((l) => l.text)
      .join('\n');
    const childDetected = parts.some((p) => p.childFeatures) || CHILD_HINTS.test(targetText);
    input.onProgress(99);
    return {
      ok: true,
      value: {
        kind: 'new_character',
        draft: draft.success ? draft.data : { cardSchemaVersion: 1, data: {} },
        suggestedClassification: {
          basis: 'real_person',
          realPersonKind: 'private_person',
          ageSetting: childDetected ? 'minor' : 'adult',
          childAppearance: childDetected,
        },
        detectedRealNames: [...realNames].slice(0, 20),
      },
    };
  }

  private async buildSupplement(
    input: Parameters<ImportAiService['analyze']>[0],
    characterId: string,
    chunks: string[],
  ): Promise<PortResult<ImportResult, AnalyzeError>> {
    const role = await this.characters.getForRuntime(input.userId, characterId);
    if (!role) return { ok: false, error: 'model_unavailable' };
    const extracted = await this.extractChunks(input, chunks);
    if (!extracted.ok) return extracted;
    const parts = extracted.value;
    const clues = {
      speechTraits: [...new Set(parts.flatMap((p) => p.speechTraits))].slice(0, 30),
      catchphrases: [...new Set(parts.flatMap((p) => p.catchphrases))].slice(0, 20),
      personalityClues: [...new Set(parts.flatMap((p) => p.personalityClues))].slice(0, 30),
      experiences: [...new Set(parts.flatMap((p) => p.experiences))].slice(0, 30),
      likes: [...new Set(parts.flatMap((p) => p.likes))].slice(0, 20),
      examples: parts.flatMap((p) => p.examples).slice(0, 10),
    };
    const result = await this.gateway.generateText({
      userId: input.userId,
      characterId,
      purpose: 'import_analysis',
      billingOwner: 'user',
      modelRole: 'chat',
      responseFormat: 'json',
      temperature: 0.3,
      maxOutputTokens: 2500,
      idempotencyKey: `${input.idempotencyKey}:supplement`,
      meta: { promptTemplateVersion: IMPORT_PROMPT_VERSION, personaVersion: role.personaVersion },
      messages: [
        {
          role: 'system',
          content:
            `用户为角色「${role.profile.name}」导入了资料，下面是从中提取的线索和角色公开资料摘要。` +
            '请写一段「我的补充设定」（第二人称或客观描述均可，≤1500 字），补充说话方式、相处细节、经历等。' +
            '规则：与公开资料矛盾的地方以公开资料为准，不写进补充设定；不涉及年龄、分类、成人内容；不编造线索以外的信息。' +
            '只输出 JSON：{"text":"..."}',
        },
        {
          role: 'user',
          content: JSON.stringify({
            publicSummary: role.card.data.persona.summary,
            clues,
          }).slice(0, 20_000),
        },
      ],
    });
    input.onProgress(95);
    if (!result.ok) return { ok: false, error: mapError(result.error) };
    const text =
      str(parseJsonObject(result.value.text)?.text, 5000) ??
      result.value.text.trim().slice(0, 5000);
    if (!text) return { ok: false, error: 'model_unavailable' };
    return { ok: true, value: { kind: 'supplement', targetCharacterId: characterId, text } };
  }
}
