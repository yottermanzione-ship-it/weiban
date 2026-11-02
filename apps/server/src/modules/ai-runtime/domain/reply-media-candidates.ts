/** 本地、无付费调用的候选筛选；只输出固定枚举，不把聊天原文交给境外决策器。 */
export type ReplyTone = 'serious' | 'warm' | 'playful' | 'neutral';

/**
 * T-20261103d：表情包情绪 = 离线标签的 10 个主标签（library_sticker_labels.primary_tag）。
 * 写回复的聊天模型自己决定带不带、带什么情绪（回复里写「[表情:中文名]」，见 sticker-marker.ts），
 * 服务端只按情绪挑一张图。label 是给模型看的中文名，顺序就是提示词里的顺序。
 */
export const STICKER_MOODS = [
  { mood: 'happy', label: '开心' },
  { mood: 'affection', label: '喜欢' },
  { mood: 'comfort', label: '安慰' },
  { mood: 'tired', label: '累了' },
  { mood: 'agreement', label: '赞同' },
  { mood: 'greeting', label: '打招呼' },
  { mood: 'goodnight', label: '晚安' },
  { mood: 'farewell', label: '再见' },
  { mood: 'thanks', label: '谢谢' },
  { mood: 'apology', label: '道歉' },
] as const;
export type StickerMood = (typeof STICKER_MOODS)[number]['mood'];
const MOOD_KEYS: ReadonlySet<string> = new Set(STICKER_MOODS.map((m) => m.mood));
export function isStickerMood(value: string): value is StickerMood {
  return MOOD_KEYS.has(value);
}

/**
 * 关键词 → 情绪。T-20261103d 起不再用来决定「要不要发」（关键词闸门已去掉），只剩三处用途：
 * 没有离线标签的旧图按 description 判断情绪、严肃场景排除含其他情绪的旧图、生态「发表情包」动作从文字里取情绪。
 */
const MEANINGS: ReadonlyArray<readonly [StickerMood, RegExp]> = [
  ['comfort', /抱抱|安慰|陪着你|陪你|别难过|不开心|伤心|难过|委屈|哭哭/u],
  ['thanks', /谢谢|感谢|多谢|辛苦了/u],
  ['apology', /对不起|抱歉|认错/u],
  ['greeting', /你好|早安|早上好|早呀|嗨嗨|打招呼/u],
  ['goodnight', /晚安|好梦|睡个好觉|睡觉觉/u],
  ['farewell', /再见|拜拜|回头见/u],
  ['affection', /爱你|喜欢你|想你|亲亲|贴贴|比心/u],
  ['happy', /开心|高兴|哈哈|大笑|笑死|好耶|撒花|庆祝|恭喜/u],
  ['tired', /困了|困困|累了|好累|疲惫|打哈欠/u],
  ['agreement', /好的|收到|没问题|同意|赞同|加油|点赞/u],
];

const SERIOUS =
  /难过|伤心|不开心|失眠|焦虑|崩溃|痛苦|害怕|担心|生病|住院|去世|分手|失业|认真说|别开玩笑/u;

export function replyTone(userText: string, reply: string): ReplyTone {
  if (SERIOUS.test(userText) || SERIOUS.test(reply)) return 'serious';
  if (/爱你|喜欢你|想你|抱抱|陪你|谢谢|感谢/u.test(reply)) return 'warm';
  if (/哈哈|好耶|笑死|嘿嘿|开心/u.test(reply)) return 'playful';
  return 'neutral';
}

/** 文字里出现的情绪关键词（按表内顺序）。 */
export function textMoods(text: string): StickerMood[] {
  // “不开心”不能又因含“开心”被判成大笑。
  const normalized = text.replace(/不开心|不高兴|别笑|不好笑|笑不出来/gu, '难过');
  return MEANINGS.filter(([, expression]) => expression.test(normalized)).map(([mood]) => mood);
}

export interface StickerOption {
  stickerId: string;
  mediaId: string;
  description: string;
  /**
   * 完整意思标签（离线打标签的产物，从 library_sticker_labels 读出，见 listStickersForCharacter）：
   * 第一项固定是主标签（10 个情绪之一，见 sticker-labels.ts buildStickerLabelTags），其后是完整描述、
   * 图里原文字、字面意思、使用意思、适合场合。有标签时以主标签判断情绪、其余几项用来挑最贴切的一张，
   * description 里的「表情 N」不再作数；没标签时退回 description 关键词判断情绪（数字说明一律排除）。
   */
  tags?: readonly string[];
}

/**
 * 一张图属于哪个情绪：有标签时看主标签（tags[0]，不在 10 个之内的不参与选图）；
 * 没标签时 description 必须有含义（空、带数字的「开心鸭 038」「表情 12」一律排除），按关键词判断，可能有多个。
 */
function stickerMoods(sticker: StickerOption): StickerMood[] {
  if (sticker.tags?.length) {
    const primary = sticker.tags[0]!.trim().toLowerCase();
    return isStickerMood(primary) ? [primary] : [];
  }
  const description = sticker.description.trim();
  if (!description || /\d/.test(description)) return [];
  return textMoods(description);
}

/** 用来和回复比相似度的文字：有标签时用主标签以外的完整意思，没标签时用 description。 */
function stickerText(sticker: StickerOption): string {
  return sticker.tags?.length ? sticker.tags.slice(1).join(' ') : sticker.description;
}

/** 本地文本相似度用的字二元组（只取字母数字连续段；单字段保留单字）。 */
function grams(text: string): Set<string> {
  const out = new Set<string>();
  for (const run of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const chars = [...run];
    if (chars.length === 1) out.add(chars[0]!);
    for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i]! + chars[i + 1]!);
  }
  return out;
}

function similarity(context: ReadonlySet<string>, text: string): number {
  const own = grams(text);
  if (!own.size || !context.size) return 0;
  let hit = 0;
  for (const gram of context) if (own.has(gram)) hit++;
  // 除以自身长度的平方根：长描述不会因为字多就总占便宜。
  return hit / Math.sqrt(own.size);
}

/** 这张图能不能用于该情绪；严肃场景（只允许安慰）下，旧图说明里同时写着别的情绪也不用（如「哈哈大笑抱抱」）。 */
function fits(sticker: StickerOption, mood: StickerMood, serious: boolean): boolean {
  const moods = stickerMoods(sticker);
  if (!moods.includes(mood)) return false;
  return !serious || moods.every((m) => m === 'comfort');
}

/**
 * 按模型给的情绪挑一张图：只在该情绪的图里挑（标签排除的图在 listStickersForCharacter 就已剔除），
 * 20 条内发过的不再挑（excludedIds）；结合回复内容与图的使用意思、适合场合算本地相似度，
 * 在最贴切的几张里按 seed 取一张，避免总是同一张。该情绪没有可用的图返回 null，绝不换别的情绪兜底。
 */
export function pickStickerForMood(
  list: readonly StickerOption[],
  mood: StickerMood,
  context: string,
  seed: number,
  excludedIds: ReadonlySet<string> = new Set(),
  serious = false,
): StickerOption | null {
  if (serious && mood !== 'comfort') return null;
  const candidates = list.filter((s) => !excludedIds.has(s.stickerId) && fits(s, mood, serious));
  if (!candidates.length) return null;
  const contextGrams = grams(context);
  const scored = candidates
    .map((sticker) => ({ sticker, score: similarity(contextGrams, stickerText(sticker)) }))
    .sort((a, b) => b.score - a.score || a.sticker.stickerId.localeCompare(b.sticker.stickerId));
  const best = scored[0]!.score;
  const pool = best > 0 ? scored.filter((x) => x.score >= best * 0.75).slice(0, 5) : scored;
  const index = Math.min(pool.length - 1, Math.floor(Math.max(0, seed) * pool.length));
  return pool[index]!.sticker;
}

/** 该角色这轮实际挑得出图的情绪（提示词只列这些，免得模型选了却没有图）。 */
export function availableStickerMoods(
  list: readonly StickerOption[],
  excludedIds: ReadonlySet<string> = new Set(),
  serious = false,
): StickerMood[] {
  const found = new Set<StickerMood>();
  for (const sticker of list) {
    if (excludedIds.has(sticker.stickerId)) continue;
    for (const mood of stickerMoods(sticker)) if (fits(sticker, mood, serious)) found.add(mood);
  }
  return STICKER_MOODS.map((m) => m.mood).filter((mood) => found.has(mood));
}

/**
 * 语音间距护栏：上一次语音之后至少要有 5 条角色文字回复才可以再发语音
 * （用户明确要语音时不受此限）。types 是最近角色消息的内容类型（新→旧或旧→新均可，
 * 本函数只数「最近一条语音之后有几条文字」）。
 */
export function voiceSpacingOk(recentTypesNewestFirst: readonly string[]): boolean {
  let textSinceVoice = 0;
  for (const type of recentTypesNewestFirst) {
    if (type === 'voice') return textSinceVoice >= 5;
    if (type === 'text') textSinceVoice++;
  }
  return true; // 从没发过语音，不受限。
}
