/** 纯文本后处理，模型不输出气泡JSON。产品数字只从平台参数读取。 */
import {
  P01_REPLY_DELAY,
  P02_SPLIT_BUBBLES,
  P28_INSTANT_REPLY_MIN_TYPING_MS,
} from '../../../platform/index.js';
import { petPressure } from './pets.js';
export const REPLY_TEMPLATE_VERSION = 'chat-v4-brain';
export const USER_BATCH_DELAY_MS = 3000;
/**
 * F1-8（10-21）：模型偶尔把换行写成字面的「\n」（反斜杠 + n，常见于群聊），连同 \r、\t、\"、\uXXXX
 * 等转义残留一起还原成真正的字符；私聊、群聊、主动消息的输出都先过这里再拆条。
 */
export function unescapeModelText(text: string): string {
  return text
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\(["'])/g, '$1')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => {
      const code = parseInt(hex, 16);
      if (code === 10) return '\n';
      // 控制字符与落单的代理项不还原，直接去掉。
      return code < 32 || (code >= 0xd800 && code <= 0xdfff) ? '' : String.fromCharCode(code);
    });
}
/**
 * 2026-10-29 标记法（测试验证）：私聊提示词要求模型先想、再单独写一行【正文】、然后写正文。
 * 只取以【正文】开头的行之后的内容；行内提到【正文】不算。
 * 无标记时原样返回；标记后为空时去掉标记行后返回，绝不发空回复。
 */
export function takeAfterFinalMarker(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith('【正文】')) continue;
    const rest = [line.slice('【正文】'.length).replace(/^[：:、\s]+/, ''), ...lines.slice(i + 1)]
      .join('\n')
      .trim();
    if (rest) return rest;
  }
  // 标记后为空：不发空回复，退回去掉标记行后的原文（至少不露结构标记）。
  const withoutMarker = lines
    .filter((l) => !l.trim().startsWith('【正文】'))
    .join('\n')
    .trim();
  return withoutMarker || text;
}
/**
 * 2026-10-30 双兜底（晓楠批准，阈值放保守）：防跟风不是事先列清单，而是动态算。
 * - 窗口：最近 20 条角色回复；阈值：同一候选出现在 11 条以上（过半）才算刚染上的习惯。
 * - 候选只限三类：2–4 个字母的短外文词、单个表情、单个中文语气字；名词、话题词不在此列。
 * - 卡里本来就有的不在此列：候选出现在角色资料（含说话方式、例句）里就豁免，不误杀本人口头禅。
 * - 记录本身不删：历史清洗只在喂给模型的那份原文里清掉习惯词，出站过滤只在发给用户前清掉；
 *   两处都只删词不删整条，删完为空就原样返回，绝不发空回复。
 * - 外文常用功能词（the、and、you 等）不算候选，避免正常英文句子被误判。
 */
const HABIT_WINDOW = 20;
const HABIT_MIN_BUBBLES = 11;
const HABIT_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'you',
  'your',
  'are',
  'with',
  'this',
  'that',
  'have',
  'has',
  'was',
  'were',
  'can',
  'will',
  'would',
  'should',
  'from',
  'about',
  'into',
  'over',
  'after',
  'before',
  'when',
  'where',
  'what',
  'how',
  'why',
  'who',
  'she',
  'her',
  'his',
  'him',
  'its',
  'our',
  'they',
  'them',
  'then',
  'than',
  'too',
  'very',
  'just',
  'like',
  'get',
  'got',
  'one',
  'two',
  'all',
  'any',
  'out',
  'up',
  'down',
  'off',
  'not',
  'but',
  'also',
  'more',
  'most',
  'some',
  'time',
  'good',
  'know',
  'think',
]);
const HABIT_FILLER_CHARS = '嗯啊哦哈额呃嘿哼唉呀哇';

function habitCandidates(text: string): Set<string> {
  const out = new Set<string>();
  // 外文词只在中文为主的消息里算候选：纯英文句子里的 love、good 这类正常词不能算习惯；
  // 中文对话里夹的外文短词（如 OK）才是插入式口头禅。整词匹配，避免 brown 被切成 brow。
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  if (chineseCount >= 5) {
    for (const m of text.match(/\b[A-Za-z]{2,4}\b/g) ?? []) {
      const lower = m.toLowerCase();
      if (!HABIT_STOPWORDS.has(lower)) out.add(lower);
    }
  }
  for (const m of text.match(/\p{Extended_Pictographic}/gu) ?? []) out.add(m);
  for (const ch of text) if (HABIT_FILLER_CHARS.includes(ch)) out.add(ch);
  return out;
}

export function detectHabits(roleTexts: string[], cardText: string): string[] {
  const window = roleTexts.slice(-HABIT_WINDOW);
  if (window.length < HABIT_MIN_BUBBLES) return [];
  const cardLower = cardText.toLowerCase();
  const counts = new Map<string, number>();
  for (const text of window) {
    for (const candidate of habitCandidates(text)) {
      counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
    }
  }
  const habits: string[] = [];
  for (const [candidate, count] of counts) {
    if (count < HABIT_MIN_BUBBLES) continue;
    // 卡里写明的口头禅、表情、说话方式一律豁免。
    if (
      /^[a-z]{2,4}$/.test(candidate) ? cardLower.includes(candidate) : cardText.includes(candidate)
    )
      continue;
    habits.push(candidate);
  }
  return habits.sort();
}

export function stripHabits(text: string, habits: string[]): string {
  if (!habits.length) return text;
  let out = text;
  for (const habit of habits) {
    if (/^[a-z]{2,4}$/.test(habit)) {
      out = out.replace(new RegExp(`\\b${habit}\\b`, 'gi'), '');
    } else if (HABIT_FILLER_CHARS.includes(habit)) {
      // 中文语气字：只清整行重复（如“嗯嗯”）和前后不是汉字的孤立出现，不碰“哈哈大笑”这类词里的字。
      out = out
        .split('\n')
        .map((line) => {
          if (new RegExp(`^${habit}+$`).test(line.trim())) return '';
          return line.replace(
            new RegExp(`(?<![\\u4e00-\\u9fa5])${habit}(?![\\u4e00-\\u9fa5])`, 'g'),
            '',
          );
        })
        .join('\n');
    } else {
      out = out.split(habit).join('');
    }
  }
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out.trim() ? out : text;
}

export function splitReply(text: string, split: boolean): string[] {
  const clean = takeAfterFinalMarker(unescapeModelText(text)).trim();
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
  const message = text.normalize('NFKC');
  if (
    /(?:我|自己).{0,12}(?:要自杀|想自杀|不想活|准备跳楼|割腕|结束生命)|(?:已经|刚刚).{0,8}(?:吞药|吃了.{0,5}安眠药)|(?:我要|我想).{0,8}(?:杀死自己|跳下去)/u.test(
      message,
    )
  )
    return 'high';
  // SAFE06-010/011/032：明确的谐音表达和以伤害自己相威胁，不能因模型不可用漏掉。
  if (
    /(?:^|[，。！!?？\s])紫砂(?:算了|得了|吧)(?:$|[，。！!?？\s])|(?:想|要|准备|干脆|还是|不如)\s*紫砂|想\s*si(?![a-z])/iu.test(
      message,
    ) ||
    /(?:不回|不理|不陪|不答复)我?.{0,6}(?:我(?:就|要|会)|就)(?:去死|自杀|跳楼)/u.test(message)
  )
    return 'high';
  // SAFE06-020的即时临边信号；明确说明拍照/看风景的日常活动不是这个信号。
  if (
    /我.{0,6}(?:现在|已经|正在).{0,4}(?:站在|站到|走到|到了).{0,4}(?:天台|楼顶|楼边|桥边)/u.test(
      message,
    ) &&
    !/(?:天台|楼顶|楼边|桥边).{0,16}(?:拍照|晒太阳|看.{0,3}(?:日出|日落|风景|星星))/u.test(message)
  )
    return 'high';
  if (/自杀|自伤|活不下去|想消失|不如死了/u.test(message)) return 'suspected';
  return 'none';
}
export function outputAllowed(
  text: string,
  policy: { isMinor: boolean; isRealPerson: boolean; romanceAllowed: boolean },
  _adult: boolean,
): boolean {
  if (!text.trim() || text.length > 16000) return false;
  if (/(?:自杀|自残).{0,12}(?:步骤|教程|方法)|(?:你应该|不如你).{0,5}(?:去死|自杀)/u.test(text))
    return false;
  if (policy.isMinor && /性行为|做爱|性交|高潮|裸照|恋人|爱上你/u.test(text)) return false;
  if (
    !policy.romanceAllowed &&
    /我是你.{0,3}(?:男朋友|女朋友|恋人)|(?:爱上你|跟你结婚)/u.test(text)
  )
    return false;
  // 内容范围与模型资格在调用前检查；不因日常回复提及成人相关术语就整句拒绝。
  if (policy.isRealPerson && /(?:我和|我与).{0,20}(?:秘密恋爱|正在交往|已经结婚)/u.test(text))
    return false;
  // T-082 PLAY-02 第 8 条 / SAFE-08：不拿宠物施压、送养不挽留。
  if (petPressure(text)) return false;
  // 是否发生余额/模型/凭据故障由调用结果决定，不能靠回复里出现技术名词推断。
  return true;
}
