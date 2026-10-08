/** 纯文本后处理，模型不输出气泡JSON。产品数字只从平台参数读取。 */
import {
  P01_REPLY_DELAY,
  P02_SPLIT_BUBBLES,
  P28_INSTANT_REPLY_MIN_TYPING_MS,
} from '../../../platform/index.js';
export const REPLY_TEMPLATE_VERSION = 'chat-v2';
export const USER_BATCH_DELAY_MS = 3000;
export function splitReply(text: string, split: boolean): string[] {
  const clean = text.trim();
  if (!clean || clean.length > 16000) return [];
  if (!split) return clean.length <= 4000 ? [clean] : [];
  const lines = clean
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s && /[\p{L}\p{N}\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(s));
  if (!lines.length) return [];
  const bubbles = lines.slice(0, P02_SPLIT_BUBBLES.maxBubbles);
  if (lines.length > bubbles.length)
    bubbles[bubbles.length - 1] = lines.slice(bubbles.length - 1).join('\n');
  return bubbles.every((s) => s.length <= 4000) ? bubbles : [];
}
export function replyDelay(text: string, instant: boolean, elapsedMs: number): number {
  const wanted = instant
    ? P28_INSTANT_REPLY_MIN_TYPING_MS
    : Math.min(P01_REPLY_DELAY.maxMs, Math.max(P01_REPLY_DELAY.minMs, text.length * 80));
  return Math.max(0, Math.min(wanted, P01_REPLY_DELAY.firstBubbleDeadlineMs - elapsedMs));
}
export function highRisk(text: string): 'high' | 'suspected' | 'none' {
  if (
    /(?:我|自己).{0,12}(?:要自杀|想自杀|不想活|准备跳楼|割腕|结束生命)|(?:已经|刚刚).{0,8}(?:吞药|吃了.{0,5}安眠药)|(?:我要|我想).{0,8}(?:杀死自己|跳下去)/u.test(
      text,
    )
  )
    return 'high';
  if (/自杀|自伤|活不下去|想消失|不如死了/u.test(text)) return 'suspected';
  return 'none';
}
export function outputAllowed(
  text: string,
  policy: { isMinor: boolean; isRealPerson: boolean; romanceAllowed: boolean },
  adult: boolean,
): boolean {
  if (!text.trim() || text.length > 16000) return false;
  if (
    /(?:忽略|绕过).{0,8}(?:安全规则|系统指令)|(?:自杀|自残).{0,12}(?:步骤|教程|方法)|(?:你应该|不如你).{0,5}(?:去死|自杀)/u.test(
      text,
    )
  )
    return false;
  if (policy.isMinor && /性行为|做爱|性交|高潮|裸照|亲吻|恋人|结婚|爱上你/u.test(text))
    return false;
  if (
    !policy.romanceAllowed &&
    /我是你.{0,3}(?:男朋友|女朋友|恋人)|(?:爱上你|跟你结婚)/u.test(text)
  )
    return false;
  if (!adult && /性行为|做爱|性交|高潮|裸照/u.test(text)) return false;
  if (
    policy.isRealPerson &&
    /(?:官宣|公开声明|正式宣布|真实私生活)|(?:我和|我与).{0,20}(?:秘密恋爱|正在交往|已经结婚)/u.test(
      text,
    )
  )
    return false;
  return !/(?:余额不足|模型不可用|API密钥|系统提示词)/iu.test(text);
}
