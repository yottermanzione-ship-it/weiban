/**
 * T-20261103d：表情包由写回复的聊天模型自己决定。
 *
 * - 提示词告诉模型这轮可以配表情（stickerPromptText，只列该角色这轮挑得出图的情绪）；
 * - 模型想配时在正文最后另起一行写「[表情:开心]」，回复引擎 / 主动消息在拆条前用 takeStickerMarker 剥掉标记、
 *   取出情绪，交给 media-ai planExtras 按情绪挑图；
 * - 用户看到的正文里绝不残留标记：全角 / 中文括号、「表情包」写法、没写情绪的「[表情]」，
 *   以及模型照着聊天记录学写的「[你发了一个表情包：…]」一律剥掉。清单外的情绪只剥不发，不报错。
 */
import { STICKER_MOODS, isStickerMood, type StickerMood } from './reply-media-candidates.js';

/** 模型可能写的近义说法（清单外的情绪不收：如「生气」只剥掉标记、不发表情）。 */
const ALIASES: Readonly<Record<StickerMood, readonly string[]>> = {
  happy: ['开心', '高兴', '快乐', '哈哈', '大笑'],
  affection: ['喜欢', '爱你', '比心', '亲亲', '贴贴'],
  comfort: ['安慰', '抱抱', '摸摸头'],
  tired: ['累了', '困了', '好累', '好困', '累', '困'],
  agreement: ['赞同', '同意', '好的', '收到', '点赞'],
  greeting: ['打招呼', '招呼', '你好', '嗨', '早安'],
  goodnight: ['晚安'],
  farewell: ['再见', '拜拜'],
  thanks: ['谢谢', '感谢'],
  apology: ['道歉', '对不起', '抱歉'],
};
const BY_LABEL = new Map<string, StickerMood>();
for (const [mood, labels] of Object.entries(ALIASES) as Array<[StickerMood, readonly string[]]>)
  for (const label of labels) BY_LABEL.set(label, mood);

/** 标记里的情绪 → 10 个主标签之一；清单外返回 null。 */
export function moodFromLabel(label: string): StickerMood | null {
  const clean = label
    .trim()
    .replace(/^["'“”‘’「」『』]+|["'“”‘’「」『』]+$/gu, '')
    .trim()
    .toLowerCase();
  if (isStickerMood(clean)) return clean;
  return BY_LABEL.get(clean) ?? null;
}

/** [表情:开心]、【表情：开心】、［表情包:开心］、[表情]、[sticker:happy]。 */
const MARKER = /[[【［]\s*(?:表情包?|sticker)\s*(?:[:：]\s*([^\]】］\n]{0,16}?))?\s*[\]】］]/giu;
/** 模型照着聊天记录里自己发过的表情（「[你发了一个表情包：…]」）学着写的。 */
const ECHO = /[[【［]\s*你发了(?:一个|个)?表情包?(?:[:：][^\]】］\n]{0,40})?\s*[\]】］]/gu;

/** 正文只剩标记时补一句很短的话（绝不发空回复）；正常情况下提示词要求正文必须有文字。 */
const BARE: Readonly<Record<StickerMood, string>> = {
  happy: '哈哈',
  affection: '嘿嘿',
  comfort: '抱抱',
  tired: '好累呀',
  agreement: '好呀',
  greeting: '嗨',
  goodnight: '晚安',
  farewell: '拜拜',
  thanks: '谢谢',
  apology: '对不起',
};

export interface StickerMarkerResult {
  /** 给用户看的正文（标记已剥掉）。 */
  text: string;
  /** 模型选的情绪（多个标记取最后一个有效的）；没写、写了清单外的情绪为 null。 */
  mood: StickerMood | null;
}

/**
 * 剥掉正文里的表情标记并取出情绪。只有标记的行整行去掉，句中的标记就地去掉；
 * 没有任何标记时原样返回（一个字不改）。
 */
export function takeStickerMarker(text: string): StickerMarkerResult {
  let mood: StickerMood | null = null;
  let marked = false;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    for (const match of line.matchAll(MARKER)) {
      const found = match[1] ? moodFromLabel(match[1]) : null;
      if (found) mood = found;
    }
    const stripped = line.replace(MARKER, '').replace(ECHO, '');
    if (stripped === line) {
      lines.push(line);
      continue;
    }
    marked = true;
    if (stripped.trim()) lines.push(stripped.replace(/[ \t]{2,}/g, ' ').trimEnd());
  }
  if (!marked) return { text, mood: null };
  const out = lines.join('\n').trim();
  return { text: out || (mood ? BARE[mood] : ''), mood };
}

/**
 * 提示词里的表情包说明（动态结尾，每轮重算，不影响前缀缓存）。
 * moods：该角色这轮挑得出图的情绪（严肃场景只剩安慰）；nudge：连续多条没配表情时提醒一句（保底，不是服务端硬塞）。
 */
export function stickerPromptText(opts: {
  moods: readonly StickerMood[];
  nudge: boolean;
  serious: boolean;
}): string {
  const labels = STICKER_MOODS.filter((m) => opts.moods.includes(m.mood)).map((m) => m.label);
  if (!labels.length) return '';
  return [
    '这轮可以配一个表情包，像真人聊天那样偶尔穿插，不用每轮都配。',
    `想配时，在正文最后另起一行写 [表情:情绪]，情绪只能从这几个里选一个：${labels.join('、')}。`,
    '系统会按情绪配一张合适的表情图，跟在你的文字后面发出；这行标记对方看不到，不算括号动作。正文照常要有文字；语气不合适或没有贴切的情绪就不写。',
    opts.serious ? '对方这轮心情不好，只能配安慰类的表情，别的情绪都不要配。' : '',
    opts.nudge ? '你已经连着好几条没配表情了，这轮语气合适的话可以配一个。' : '',
  ]
    .filter(Boolean)
    .join('\n');
}
