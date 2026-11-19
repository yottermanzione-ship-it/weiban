import type { ChatTurnMessage } from './prompt-assembly.js';

// Only a complete, short opening clause counts. A shared topic prefix can start unrelated sentences.
const OPENING = /^([\p{Script=Han}]{2,8})(?:[，,。.!！~～…\s]+|$)/u;

/** Each user turn contributes at most one opening, even when the character sends several bubbles. */
export function repeatedReplyOpening(history: readonly ChatTurnMessage[]): string | null {
  const recent: (string | null)[] = [];
  for (let i = history.length - 1; i > 0 && recent.length < 12; i--) {
    const turn = history[i]!;
    if (turn.role === 'assistant' && history[i - 1]!.role === 'user') {
      recent.push(OPENING.exec(turn.content.trimStart())?.[1] ?? null);
    }
  }
  // A short burst triggers early. A longer-established pattern gets time to subside
  // without switching the reminder off as soon as two or three replies improve.
  const common = (window: (string | null)[], minimum: number) =>
    window.find((phrase) => phrase && window.filter((value) => value === phrase).length >= minimum);
  return common(recent.slice(0, 5), 3) ?? common(recent, 4) ?? null;
}

// For other phrases (including meaningful answers such as “不行”), vary the wording in generation
// only. A repeated presence acknowledgement can be omitted when a separate substantive answer follows.
const PRESENCE = /^(?:我|我还|还)?在(?:呢|的|呀|啊|这里|这儿)$/u;
const CHECKING_PRESENCE =
  /在[吗嘛么不]|还在|在线|人呢|听[得见到]|能听|应[我一]|回[我个一]|陪[我着]|陪陪|别走|别离开|别不理|[你您]在[哪这]|有人[吗嘛么]|喂/u;
const CALLING_OUT =
  /^(?:在|有人|嗨|嘿|你好|您好|哈喽|宝宝|宝贝|亲爱的|哥哥|姐姐|老师|老公|老婆)[~～？！?!。,.，\s]*$/u;

export function omitRepeatedPresence(
  bubbles: string[],
  opening: string | null,
  userText: string,
): string[] {
  const first = bubbles[0];
  if (!first || !opening || !PRESENCE.test(opening)) return bubbles;
  const match = OPENING.exec(first);
  if (match?.[1] !== opening) return bubbles;
  if (
    CALLING_OUT.test(userText.trim()) ||
    userText.includes(opening) ||
    CHECKING_PRESENCE.test(userText)
  ) {
    return bubbles;
  }
  const remainder = first.slice(match[0].length);
  const result = remainder ? [remainder, ...bubbles.slice(1)] : bubbles.slice(1);
  return result.some((bubble) => /[\p{L}\p{N}]/u.test(bubble)) ? result : bubbles;
}
