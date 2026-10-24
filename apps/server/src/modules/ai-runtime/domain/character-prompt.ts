/**
 * 角色卡 → 稳定开头里的「你是谁 / 怎么说话 / 说话示例」（docs/refactor/09-chat-pipeline.md 第 4、7 节）。
 * 纯函数；同一人设版本输出逐字相同，保证前缀缓存。原先整段 JSON 塞入，现在改成「标签：值」短行。
 */
import type { ScenarioMode, WeibanCardData } from '@weiban/contracts';
import { scenarioText } from './persona.js';
import { STYLE_TEXT } from './scenario.js';
import { line, lines, takeWithin } from './prompt-assembly.js';

const TAG: Record<string, string> = {
  tsundere: '傲娇',
  aloof: '高冷',
  shy: '害羞',
  gentle: '温柔',
  sharpTongue: '毒舌',
  cheerful: '元气',
  calm: '沉稳',
  playful: '爱玩闹',
  airhead: '天然呆',
  mature: '成熟',
};
const SENTENCE = { veryShort: '很短', short: '偏短', medium: '中等', long: '偏长' } as const;
const FREQ = { none: '不用', rare: '很少', sometimes: '有时', often: '经常' } as const;
const CATCH = { rare: '偶尔', sometimes: '有时', often: '常常' } as const;
const SCENE: Record<string, string> = {
  greeting: '打招呼',
  daily: '日常',
  praised: '被夸',
  teased: '被逗',
  comfort: '安慰对方',
  refuseInCharacter: '按人设拒绝',
  deflectRumor: '回避传闻',
  workTalk: '聊工作',
  lateNight: '深夜',
  group: '群聊',
};

export function characterCoreText(
  name: string,
  occupation: string | undefined,
  card: WeibanCardData,
): string {
  const p = card.persona;
  const growth = p.growthByFamiliarity
    ? Object.entries(p.growthByFamiliarity)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k} ${v}`)
        .join('；')
    : '';
  return lines([
    line('名字', name),
    line('身份', occupation),
    line('简介', p.summary),
    line('经历', p.background),
    line('性格', p.personality),
    line('情绪基调', p.emotionalTone),
    line('价值观', p.values),
    line('喜欢', p.likes),
    line('不喜欢', p.dislikes),
    line('性格标签', [...p.personaTags.map((t) => TAG[t] ?? t), ...(p.personaTagsCustom ?? [])]),
    line('对用户的默认态度', p.defaultAttitudeToUser),
    line('随熟悉程度的变化', growth),
    line('世界观补充', p.worldNote),
  ]);
}

export function speechText(card: WeibanCardData): string {
  const s = card.speech;
  return lines([
    line('自称', s.selfReference),
    line('默认称呼对方', s.addressUserDefault),
    line('语气', s.tone),
    line('句子长度', SENTENCE[s.sentenceLength]),
    s.catchphrases?.length
      ? `口头禅（${CATCH[s.catchphraseFrequency ?? 'sometimes']}用）：${s.catchphrases.join('、')}`
      : null,
    `表情符号：${FREQ[s.emojiHabit.frequency]}${s.emojiHabit.favorites.length ? `，常用 ${s.emojiHabit.favorites.join(' ')}` : ''}`,
    line('标点习惯', s.punctuationHabit),
    line('方言', s.dialect),
    line('不说的词', s.forbiddenWords),
    line('语言补充', s.languageNotes),
  ]);
}

export function safetyStyleText(card: WeibanCardData): string {
  const s = card.safetyStyle;
  return lines([
    line('关怀时的口吻', s.careVoice),
    line('岔开话题的方式', s.deflectStyle),
    line('拒绝要自拍时', s.refuseSelfieStyle),
    '图片能力边界：不能生成图片、拍照或自拍，不从日常图库抽图，也不拿网页封面凑普通图片。只有系统核对人物、出处和原始时间并确认可发送的图片才能分享；未确认实际发送前，不要声称已有图片或已经发送，更不能把公开旧图说成真人刚拍、编造真人新活动。',
  ]);
}

type Example = WeibanCardData['examples'][number];

function exampleText(e: Example, userName: string): string {
  return `（${SCENE[e.scene] ?? e.scene}）\n${e.turns
    .map((t) => `${t.role === 'user' ? userName : '你'}：${t.text}`)
    .join('\n')}`;
}

/**
 * 稳定开头里固定的示例对话（酒馆「示例对话常驻」的做法）：按卡片顺序，先保证场景不重复，
 * 再按顺序补满；同一人设版本永远选出同样几条。默认最多 6 条、约 1,800 字。
 */
export function pinnedExamples(
  examples: Example[],
  opts: { max?: number; maxChars?: number } = {},
): Example[] {
  const max = opts.max ?? 6;
  const seen = new Set<string>();
  const firstOfScene: Example[] = [];
  for (const e of examples) {
    if (seen.has(e.scene)) continue;
    seen.add(e.scene);
    firstOfScene.push(e);
  }
  const rest = examples.filter((e) => !firstOfScene.includes(e));
  const ordered = [...firstOfScene, ...rest].slice(0, max);
  // 保持卡片原顺序输出，便于作者对照
  const picked = examples.filter((e) => ordered.includes(e));
  const texts = takeWithin(
    picked.map((e) => exampleText(e, '对方')),
    opts.maxChars ?? 1800,
  );
  return picked.slice(0, texts.length);
}

export function examplesText(examples: Example[]): string {
  if (!examples.length) return '';
  return `下面是说话方式的示范，只学语气和长短，不要照抄内容，也不是你们真实聊过的事：\n\n${examples
    .map((e) => exampleText(e, '对方'))
    .join('\n\n')}`;
}

/**
 * 尾部按情境补 1 条示例（不在稳定开头里的那些）：深夜、安慰、被逗等场景命中时才给。
 */
export function situationalExample(
  examples: Example[],
  pinned: Example[],
  scenes: string[],
): Example | null {
  for (const scene of scenes) {
    const hit = examples.find((e) => e.scene === scene && !pinned.includes(e));
    if (hit) return hit;
  }
  return null;
}

export function situationalExampleText(e: Example): string {
  return `这种情境下你说话的样子（示范，不照抄）：\n${exampleText(e, '对方')}`;
}

/** 3.39：旧 moment_profile_json.topics → 朋友圈常写主题（最多 8 条，仅进朋友圈生成提示）。 */
export function momentsTopicsText(topics: string[] | undefined): string {
  const list = (topics ?? [])
    .map((topic) => topic.trim())
    .filter(Boolean)
    .slice(0, 8);
  return list.length ? `常写主题：${list.join('、')}。` : '';
}

/** 作者注释（情景风格提示）固定插在倒数第 4 条消息之前（酒馆默认深度 4）。 */
export const AUTHOR_NOTE_DEPTH = 4;
/** 角色笔记默认深度（酒馆 depth prompt 默认 4）。 */
export const CHARACTER_NOTE_DEPTH = 4;

/**
 * 作者注释式的「写作提示」（docs/refactor/09 第 7.4 节）：一句人设锚点 + 当前情景风格。
 * 放在固定深度而不是开头：长对话里模型越来越「忘」开头的人设，离回答近的短提示最管用。
 * 日常模式且没有本轮风格时只给人设锚点。
 */
export function scenarioNote(
  card: WeibanCardData,
  mode: ScenarioMode,
  autoStylePrompt: string | null,
): string {
  const anchor = `继续以{{char}}的身份和口吻回复：${card.speech.tone.slice(0, 60)}；句子${SENTENCE[card.speech.sentenceLength]}。`;
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
