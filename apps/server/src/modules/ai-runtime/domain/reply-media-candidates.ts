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
   * 离线标签文本（library_sticker_labels 读出，见 listStickersForCharacter）。
   * 本分支只负责读出、不改选图口径：selectReplySticker 暂不消费 tags，仍按 description 匹配。
   */
  tags?: readonly string[];
}
export interface ReplyStickerCandidate {
  sticker: StickerOption;
  meaning: StickerMeaning;
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
    if (!description || /\d/.test(description)) continue; // 导入的“开心鸭 038”等不冒充语义标签。
    const matching = meanings(description);
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
