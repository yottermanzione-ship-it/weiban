/** 本地、无付费调用的候选筛选；只输出固定枚举，不把聊天原文交给境外决策器。 */
export type ReplyTone = 'serious' | 'warm' | 'playful' | 'neutral';
const MEANINGS = [
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
] as const;
export type StickerMeaning = (typeof MEANINGS)[number][0];

const SERIOUS =
  /难过|伤心|不开心|失眠|焦虑|崩溃|痛苦|害怕|担心|生病|住院|去世|分手|失业|认真说|别开玩笑/u;

export function replyTone(userText: string, reply: string): ReplyTone {
  if (SERIOUS.test(userText) || SERIOUS.test(reply)) return 'serious';
  if (/爱你|喜欢你|想你|抱抱|陪你|谢谢|感谢/u.test(reply)) return 'warm';
  if (/哈哈|好耶|笑死|嘿嘿|开心/u.test(reply)) return 'playful';
  return 'neutral';
}

function meanings(text: string): StickerMeaning[] {
  // “不开心”不能又因含“开心”被判成大笑。
  const normalized = text.replace(/不开心|不高兴|别笑|不好笑|笑不出来/gu, '难过');
  return MEANINGS.filter(([, expression]) => expression.test(normalized)).map(
    ([meaning]) => meaning,
  );
}

export interface StickerOption {
  stickerId: string;
  mediaId: string;
  description: string;
  /**
   * 完整意思标签（离线打标签的产物）：完整描述 + 图里原文字 + 字面意思 + 使用意思 +
   * 适合/不适合场合。有标签时以标签为准选图，description 里的「表情 N」不再作数；
   * 没标签时退回 description 含义匹配（数字说明一律排除，见 selectReplySticker）。
   */
  tags?: readonly string[];
}
export interface ReplyStickerCandidate {
  sticker: StickerOption;
  meaning: StickerMeaning;
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

/** 只从有含义且和回复相符的素材选；系列名+文件编号不算含义，无匹配绝不随机兜底。 */
export function selectReplySticker(
  list: readonly StickerOption[],
  reply: string,
  userText: string,
  seed: number,
  excludedIds: ReadonlySet<string> = new Set(),
): ReplyStickerCandidate | null {
  const tone = replyTone(userText, reply);
  const desired = meanings(reply).filter((meaning) => tone !== 'serious' || meaning === 'comfort');
  if (!desired.length) return null;
  const candidates: ReplyStickerCandidate[] = [];
  for (const sticker of list) {
    if (excludedIds.has(sticker.stickerId)) continue;
    const description = sticker.description.trim();
    // 有完整标签时以标签文本为准（标签里含数字也不算「表情 N」）；没标签时 description
    // 必须有含义：空、带数字的「开心鸭 038」「表情 12」一律排除，绝不随机兜底。
    const labelText = sticker.tags?.length ? sticker.tags.join(' ') : description;
    if (!labelText.trim()) continue;
    if (!sticker.tags?.length && /\d/.test(description)) continue; // 导入的“开心鸭 038”等不冒充语义标签。
    const matching = meanings(labelText);
    // 严肃场景即便同时写着“抱抱”也不能选“哈哈大笑抱抱”。
    if (tone === 'serious' && matching.some((meaning) => meaning !== 'comfort')) continue;
    const meaning = desired.find((item) => matching.includes(item));
    if (meaning) candidates.push({ sticker, meaning });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.sticker.stickerId.localeCompare(b.sticker.stickerId));
  const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, seed) * candidates.length));
  return candidates[index] ?? null;
}
