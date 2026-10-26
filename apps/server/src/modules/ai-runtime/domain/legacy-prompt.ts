/**
 * 旧角色卡的提示词片段（纯函数）。
 *
 * **旧卡就是运行格式**：这里直接读 `LegacyCharacterCard` 的旧字段，不构造 `WeibanCardData`、
 * 不做字段映射。新卡角色仍走 `character-prompt.ts` 的现有逻辑。
 */
import type {
  LegacyCharacterCard,
  LegacyDialogueExample,
  LegacyKnowledgeEntry,
  ScenarioMode,
} from '@weiban/contracts';
import { line, lines, takeWithin } from './prompt-assembly.js';
import { STYLE_TEXT } from './scenario.js';
import { scenarioText } from './persona.js';

/** 旧卡没有安全风格字段时用的兜底话术（代码层关怀与岔题仍照常执行）。 */
export const LEGACY_CARE_FALLBACK =
  '我在这儿陪着你。先告诉我你现在安全吗？身边有信任的人可以陪你吗？也可以打 12356。';
export const LEGACY_DEFLECT = '这个话题先放一放，好吗？我们聊聊你今天过得怎么样。';

/** 「你是谁」：旧卡核心人设与灵魂设定原样进稳定开头。 */
export function legacyCoreText(card: LegacyCharacterCard): string {
  return lines([
    line('名字', card.displayName),
    line('昵称', card.nickname),
    line('别名', card.aliases),
    line('签名', card.signature),
    line('性别', card.identityGender),
    line('核心人设', card.corePersona),
    line('性格', card.soulPersonality),
    line('情绪基调', card.soulEmotionalTone),
    line('关系模式', card.soulRelationshipMode),
    line('关系设定', card.relationshipMode),
  ]);
}

/** 「说话方式」：旧卡 speaking_style / style_* 原样进稳定开头。 */
export function legacySpeechText(card: LegacyCharacterCard): string {
  return lines([
    line('说话风格', card.speakingStyle),
    line('聊天风格', card.styleChatStyle),
    line('表情符号程度', card.styleEmojiLevel),
    line('避免的表达', card.styleAvoid),
  ]);
}

/** 群聊/朋友圈等较小的提示里需要的人设与说话风格（旧字段原文，截断到 max）。 */
export function legacyPersonaSpeechText(card: LegacyCharacterCard, max = 6000): string {
  return [
    `核心人设：${card.corePersona}`,
    card.soulPersonality ? `性格：${card.soulPersonality}` : '',
    card.soulEmotionalTone ? `情绪基调：${card.soulEmotionalTone}` : '',
    card.speakingStyle ? `说话风格：${card.speakingStyle}` : '',
    card.styleChatStyle ? `聊天风格：${card.styleChatStyle}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

/** 旧卡知识为空时的未知处理（不编造），不是平台护栏。 */
export function legacyUnknownPolicy(): string {
  return '不知道就说不知道，不编造不存在的作品、公开声明或共同经历。';
}

function exampleLine(example: LegacyDialogueExample): string {
  const scene = example.scene ? `（${example.scene}）` : '';
  const turns = [
    example.userText ? `对方：${example.userText}` : '',
    example.assistantText ? `你：${example.assistantText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${scene}\n${turns}`;
}

/** 旧库示例对话（user_text / assistant_text）→ 说话示例。 */
export function legacyExamplesText(examples: readonly LegacyDialogueExample[]): string {
  if (!examples.length) return '';
  return `下面是说话方式的示范，只学语气和长短，不要照抄内容，也不是你们真实聊过的事：\n\n${examples
    .map(exampleLine)
    .join('\n\n')}`;
}

/** 稳定开头里固定的旧卡示例：先保证场景不重复，再按原顺序补满，预算内截断。 */
export function legacyPinnedExamples(
  examples: readonly LegacyDialogueExample[],
  opts: { max?: number; maxChars?: number } = {},
): LegacyDialogueExample[] {
  const max = opts.max ?? 6;
  const seen = new Set<string>();
  const firstOfScene: LegacyDialogueExample[] = [];
  for (const example of examples) {
    if (seen.has(example.scene)) continue;
    seen.add(example.scene);
    firstOfScene.push(example);
  }
  const rest = examples.filter((example) => !firstOfScene.includes(example));
  const ordered = [...firstOfScene, ...rest].slice(0, max);
  const picked = examples.filter((example) => ordered.includes(example));
  const texts = takeWithin(
    picked.map((example) => exampleLine(example)),
    opts.maxChars ?? 1800,
  );
  return picked.slice(0, texts.length);
}

export interface LegacyLorebookOptions {
  constantChars: number;
  triggeredChars: number;
  recursionDepth: number;
}

/** 旧卡世界书默认预算；与卡片世界书默认值一致，避免两套口径。 */
export const LEGACY_LOREBOOK_OPTIONS: LegacyLorebookOptions = {
  constantChars: 900,
  triggeredChars: 1200,
  recursionDepth: 1,
};

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function budget(entries: LegacyKnowledgeEntry[], maxChars: number): LegacyKnowledgeEntry[] {
  const out: LegacyKnowledgeEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const size = entry.title.length + entry.content.length + 4;
    if (used + size > maxChars) continue;
    out.push(entry);
    used += size;
  }
  return out;
}

/**
 * 旧库世界书：constant 条目进稳定开头，关键词条目按扫描文本触发（可递归 1 层）。
 * 旧表没有 confidence 字段，不按真人/虚构来源过滤——旧卡知识就是角色资料。
 */
export function legacyLorebook(
  entries: readonly LegacyKnowledgeEntry[],
  scanText: string,
  options: LegacyLorebookOptions = LEGACY_LOREBOOK_OPTIONS,
): { constant: LegacyKnowledgeEntry[]; triggered: LegacyKnowledgeEntry[] } {
  const byPriority = (a: LegacyKnowledgeEntry, b: LegacyKnowledgeEntry) =>
    b.priority - a.priority || a.id.localeCompare(b.id);
  const constant = budget(
    entries.filter((entry) => entry.constant).sort(byPriority),
    options.constantChars,
  );
  const pool = entries.filter((entry) => !entry.constant);
  const fired = new Set<LegacyKnowledgeEntry>();
  let scan = normalize(scanText);
  const fires = (entry: LegacyKnowledgeEntry, text: string) =>
    entry.keys.some((key) => key.trim() && text.includes(normalize(key)));
  for (let round = 0; round <= options.recursionDepth; round++) {
    const fresh = pool.filter((entry) => !fired.has(entry) && fires(entry, scan));
    if (!fresh.length) break;
    for (const entry of fresh) fired.add(entry);
    scan = normalize(fresh.map((entry) => `${entry.title}\n${entry.content}`).join('\n'));
    if (!scan) break;
  }
  return { constant, triggered: budget([...fired].sort(byPriority), options.triggeredChars) };
}

/** 旧卡世界书条目 → 短行（与卡片世界书输出格式一致）。 */
export function legacyLorebookText(entries: readonly LegacyKnowledgeEntry[]): string {
  return entries
    .map((entry) => `· ${entry.title ? `${entry.title}：` : ''}${entry.content}`)
    .join('\n');
}

/**
 * 作者注释式的写作提示：旧卡用 speaking_style 取锚点；情景风格与卡片角色共用同一套文本。
 * 不是平台护栏，只是每轮变化的短提示。
 */
export function legacyScenarioNote(
  card: LegacyCharacterCard,
  mode: ScenarioMode,
  autoStylePrompt: string | null,
): string {
  const anchor = `继续以{{char}}的身份和口吻回复：${(card.speakingStyle || card.corePersona).slice(0, 60)}。`;
  const style =
    mode === 'auto'
      ? (autoStylePrompt ?? '')
      : mode === 'treehole' || mode === 'cheer' || mode === 'tsundere'
        ? `【当前情景】${STYLE_TEXT[mode]}`
        : mode === 'daily'
          ? ''
          : `【当前情景】${scenarioText(mode)}`;
  return `【写作提示】${anchor}${style ? `\n${style}` : ''}`;
}
