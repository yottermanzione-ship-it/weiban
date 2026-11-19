// Only a complete, short opening clause counts. A shared topic prefix can start unrelated sentences.
const OPENING = /^([\p{Script=Han}]{2,8})(?:[，,。.!！~～…\s]+|$)/u;
const RECOVERY_TURNS = 12;
const STRONG_RECOVERY_TURNS = 2 * RECOVERY_TURNS;
export const REPLY_OPENING_HISTORY_TURNS = STRONG_RECOVERY_TURNS + RECOVERY_TURNS - 1;

/** Oldest first, one actual first bubble per normal reply. Media occupies a turn with no text. */
export function repeatedReplyOpening(firstBubbles: readonly (string | null)[]): string | null {
  const recent = firstBubbles
    .slice(-REPLY_OPENING_HISTORY_TURNS)
    .reverse()
    .map((text) => (text ? (OPENING.exec(text.trimStart())?.[1] ?? null) : null));
  // Give an ordinary loop one window to subside. When the same clause opened at least
  // two thirds of a full window, allow two windows: the first few improved replies are
  // weak evidence that a strongly entrenched pattern has actually gone away.
  for (let age = 0; age < Math.min(recent.length, STRONG_RECOVERY_TURNS); age++) {
    const opening = recent[age];
    if (!opening) continue;
    const preceding = recent.slice(age, age + RECOVERY_TURNS);
    const matches = (phrase: string | null) => phrase === opening;
    const occurrences = preceding.filter(matches).length;
    if (
      occurrences >= 8 ||
      (age < RECOVERY_TURNS &&
        (preceding.slice(0, 5).filter(matches).length >= 3 || occurrences >= 4))
    )
      return opening;
  }
  return null;
}

// For other phrases (including meaningful answers such as “不行”), vary the wording in generation
// only. A repeated presence acknowledgement can be omitted when a separate substantive answer follows.
const PRESENCE = /^(?:我|我还|还)?在(?:呢|的|呀|啊|这里|这儿)$/u;
const CHECKING_PRESENCE =
  /在[吗嘛么不]|还在|在线|人呢|听[得见到]|能听|应[我一]|回[我个一]|陪[我着]|陪陪|别走|别离开|别不理|[你您]在[哪这]|有人[吗嘛么]|喂/u;
const CALLING_OUT =
  /^(?:在|有人|嗨|嘿|你好|您好|哈喽|宝宝|宝贝|亲爱的|哥哥|姐姐|老师|老公|老婆)[~～？！?!。,.，\s]*$/u;

export function userInvitesOpening(opening: string, userText: string): boolean {
  return (
    userText.includes(opening) ||
    (PRESENCE.test(opening) &&
      (CALLING_OUT.test(userText.trim()) || CHECKING_PRESENCE.test(userText)))
  );
}

export function omitRepeatedPresence(
  bubbles: string[],
  opening: string | null,
  userText: string,
): string[] {
  const first = bubbles[0];
  if (!first || !opening || !PRESENCE.test(opening)) return bubbles;
  const match = OPENING.exec(first);
  if (match?.[1] !== opening) return bubbles;
  if (userInvitesOpening(opening, userText)) return bubbles;
  const remainder = first.slice(match[0].length);
  const result = remainder ? [remainder, ...bubbles.slice(1)] : bubbles.slice(1);
  return result.some((bubble) => /[\p{L}\p{N}]/u.test(bubble)) ? result : bubbles;
}
