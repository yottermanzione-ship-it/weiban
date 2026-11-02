/**
 * 聊天里「不喜欢某一种形式」的会话压制（多样性草案 §1、对照表 v3 第 13 项）。
 *
 * - 只认用户在聊天里明确说出来的话（关键词 + 明确语义），不猜测、不推断。
 * - 只压制说的那一种形式（表情包 / 语音 / 拍一拍），只针对这个用户 + 这个角色的当前会话。
 * - 用户后来明确要那种形式（「发表情包」「发语音」「拍拍我」），压制就恢复。
 * - 不是设置开关：不写任何设置表；每次从最近的用户消息里重新算，算出来的结果可检查
 *   （返回每条压制是被哪句话、在第几条触发的），误压不会悄悄一直留着。
 *
 * 「会话」在这里就是最近一段聊天记录（调用方传最近 N 条用户原话）；没有跨会话的持久状态。
 */
export type ChatForm = 'sticker' | 'voice' | 'nudge';

export interface FormSuppression {
  form: ChatForm;
  /** 触发压制的用户原话（截短）。 */
  text: string;
  /** 在传入数组里的下标（越靠后越新）。 */
  index: number;
}

const DISLIKE: ReadonlyArray<{ form: ChatForm; re: RegExp }> = [
  {
    form: 'sticker',
    re: /别发(个|张|一[个张])?(表情包?|表情)|不要发(个|张)?(表情包?|表情)|别发表情|不喜欢(发)?表情|不要表情包|别用表情包/u,
  },
  {
    form: 'voice',
    re: /别发(条|段|一[条段])?语音|不要发(条|段)?语音|别用语音|不喜欢(发)?语音|不要语音消息|别发语音消息/u,
  },
  { form: 'nudge', re: /别拍(我|拍)?|不要拍(我)?|别拍一拍|不喜欢被拍|别拍我了/u },
];

const REQUEST: ReadonlyArray<{ form: ChatForm; re: RegExp }> = [
  { form: 'sticker', re: /发(个|张|一[个张])?(表情包?|表情)|来(个|张)表情包/u },
  { form: 'voice', re: /发(条|段|一[条段])?语音|用语音(说|讲|回)?|来(条|段)语音|语音(说|讲)给我/u },
  { form: 'nudge', re: /拍(一)?拍我|拍我一下|拍一拍我|拍拍我/u },
];

/**
 * 按时间顺序扫最近的用户原话：后说的覆盖先说的。
 * 返回当前仍被压制的形式 + 每条压制的来源（供检查 / 排查误压）。
 */
export function detectFormSuppressions(userTexts: readonly string[]): {
  suppressed: ReadonlySet<ChatForm>;
  reasons: FormSuppression[];
} {
  const active = new Map<ChatForm, FormSuppression>();
  userTexts.forEach((raw, index) => {
    const text = raw.normalize('NFKC');
    const disliked = new Set<ChatForm>();
    for (const { form, re } of DISLIKE) {
      if (re.test(text)) {
        disliked.add(form);
        active.set(form, { form, text: text.slice(0, 60), index });
      }
    }
    // 同一句话里既说「别发语音」又说「发表情包」时，各管各的；「别发语音」这句话本身
    // 不能因为含有「发语音」三个字就被当成「要语音」而恢复——同形式同句内，压制优先。
    for (const { form, re } of REQUEST) {
      if (!disliked.has(form) && re.test(text)) active.delete(form);
    }
  });
  return { suppressed: new Set(active.keys()), reasons: [...active.values()] };
}

export function isFormSuppressed(userTexts: readonly string[], form: ChatForm): boolean {
  return detectFormSuppressions(userTexts).suppressed.has(form);
}
