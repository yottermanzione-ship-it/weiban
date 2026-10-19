/**
 * 「留住人」（v5 批 B，docs/refactor/18-keep-chatting.md）。纯函数。
 *
 * - 平台守则加两条：不主动结束对话；对方要走时撒娇挽留一次、坚持就温柔放行并留个期待。
 * - 写作提示（倒数第 4 条之前，本来就每轮变）在检测到冷场或告别意图时追加一句本轮提示，不碰稳定开头。
 * - 不挽留：考试 / 上班 / 身体不适 / 凌晨 1 点后说困 / 安全关怀中；一次告别最多挽留一次。
 */

/** 平台守则（稳定开头）新增的一段。改它会让所有会话的开头缓存失效一次。 */
export const KEEP_CHATTING_RULE =
  '不主动结束对话：对方没说要走时，不说「先睡吧」「早点休息」「不打扰你了」「你去忙吧」这类结束语，冷场时按性格接一个话题。对方说要走时，可以撒娇、轻松地挽留一次；对方坚持就温柔放行，留一个下次的期待。不让对方内疚，不反复纠缠，不拿难过、离开或伤害自己做筹码；对方要考试、上班、身体不舒服、深夜犯困或正需要关怀时不挽留，真心关心对方。';

const GOODBYE =
  /(晚安|拜拜|再见|先睡了|去睡了|要睡了|睡觉了|我睡了|睡啦|睡了[吧啊哦呀~～!！。.]*$|先下了|下线了|先走了|我走了|要走了|不聊了|先不聊|回头聊|改天聊|明天聊|下次聊|先这样吧?|去忙了|我去忙|忙去了|^88$|^886$|^bye)/iu;
/** 有正事或身体原因：不挽留，反过来关心。 */
const SERIOUS =
  /(考试|期末|期中|考研|上班|上早班|开会|加班|面试|赶工|交稿|deadline|ddl|身体不舒服|不舒服|生病|发烧|感冒|头疼|头痛|肚子疼|胃疼|难受|去医院|看病|吃药)/iu;
const SLEEPY = /(困|想睡|要睡了|睡了[吧啊哦呀~～!！。.]*$|眼睛.{0,2}睁不开|撑不住了)/u;
const SHORT_FILLER =
  /^(嗯+|嗯嗯+|哦+|噢+|喔+|好+|好的|好吧|行+|行吧|可以|ok|okay|哈+|哈哈+|呵呵|嘿嘿|嘻嘻|额+|呃+|是吗|是哦|这样啊|对|对啊|还行|随便|无聊|没事|没什么)$/iu;

export function hasGoodbyeIntent(text: string): boolean {
  return GOODBYE.test(text.trim());
}

/** 冷场：用户这轮只回了常见的应付话（「嗯」「哈哈」「好」…，去掉表情和标点后判断）或只发了表情。 */
export function isColdReply(text: string): boolean {
  const flat = text
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
    .replace(/[\s,，。！!？?、~～…:：;；.]/gu, '');
  if (!flat) return text.trim().length > 0; // 只发了表情
  return SHORT_FILLER.test(flat);
}

export type KeepChattingCase =
  'none' | 'cold' | 'goodbye_first' | 'goodbye_persist' | 'goodbye_care';

export function keepChattingCase(input: {
  /** 本轮用户说的话。 */
  userText: string;
  /** 上一轮（角色回复之前那一段）用户说的话；没有为 null。 */
  previousUserTurn: string | null;
  /** 上一轮用户消息距现在多久（毫秒）；没有为 null。 */
  previousGapMs: number | null;
  /** 用户当地小时（0–23）。 */
  localHour: number;
  /** 安全关怀中或本轮高风险。 */
  inCare: boolean;
}): KeepChattingCase {
  const text = input.userText.trim();
  if (!text || input.inCare) return 'none';
  // 凌晨 1 点后说困：不挽留，反过来关心（这时说「快去睡」是对的）。
  if (input.localHour >= 1 && input.localHour < 5 && SLEEPY.test(text)) return 'goodbye_care';
  if (hasGoodbyeIntent(text)) {
    if (SERIOUS.test(text)) return 'goodbye_care';
    // 一次告别最多挽留一次：上一轮（30 分钟内）已经说过要走，这次放行。
    if (
      input.previousUserTurn &&
      hasGoodbyeIntent(input.previousUserTurn) &&
      (input.previousGapMs ?? Infinity) <= 30 * 60_000
    )
      return 'goodbye_persist';
    return 'goodbye_first';
  }
  if (SERIOUS.test(text)) return 'none';
  return isColdReply(text) ? 'cold' : 'none';
}

const HINTS: Record<Exclude<KeepChattingCase, 'none'>, string> = {
  cold: '【本轮提示】对方回得很短。别顺势结束话题，按你的性格主动接一个：问问对方今天的事、说说你自己的日常，或提起你们之间记得的事。',
  goodbye_first:
    '【本轮提示】对方想结束聊天。可以按你的性格撒娇、轻松地挽留一次（比如「再陪我五分钟嘛」，或抛出一件想跟对方说的小事）；不让对方内疚，不说难过或被丢下。',
  goodbye_persist:
    '【本轮提示】对方坚持要走，温柔放行，不再挽留；留一个下次的期待（约好下次聊什么，或让对方回头告诉你某件事的结果）。',
  goodbye_care:
    '【本轮提示】对方有正事、身体不舒服或真的困了，不挽留；真心关心一句，让对方安心去（这时说「快去睡」「加油」是对的）。',
};

export function keepChattingHint(kind: KeepChattingCase): string | null {
  return kind === 'none' ? null : HINTS[kind];
}
