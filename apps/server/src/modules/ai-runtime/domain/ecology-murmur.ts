/**
 * 碎碎念（对照表 v3「TA 的生活」第 5、23 项）的纯规则：素材组装、截断、元话语过滤。
 *
 * 2026-11-03 修正（T-20261103b）：之前把给 Jev 的运营摘要（「对方上次发消息在…；角色发了还没被回的
 * 消息 N 条」「角色今天已经做过…」）原样喂给写碎碎念的模型，输出像在复述提示词；输出上限 80 token
 * 还会把句子截断。现在：
 * - 素材单独组装，只有当前时段、角色自己的生活（状态、签名、自己最近发的动态、今天的事）和这次做了什么，
 *   用第一人称「我」的口吻写；不含聊天计数、未回条数等运营指标，也不出现「对方 / 用户 / 角色」这类称呼
 *   （含这些词的素材条目整条丢掉，不改写）；
 * - 输出在服务端截到 60 字以内，截断点落在句末标点；
 * - 输出里出现元话语或像在复述指令，整条丢弃，不重试、不写库。
 */
import { healthPrivate } from './memory.js';

/** 碎碎念最多多少字（按字符计，emoji 等算一个）。 */
export const MURMUR_MAX_CHARS = 60;
/** 写碎碎念的输出上限：给足一两句话的余量，长了由服务端截断，不靠模型自己停。 */
export const MURMUR_MAX_OUTPUT_TOKENS = 200;

/** 素材里不能出现的第三人称称呼（运营口吻）。 */
const MATERIAL_BANNED = /对方|用户|角色/u;

/**
 * 输出里的元话语：出现就整条丢弃（总经理 11-03：宁静那条像提示词）。
 * 「好的」「作为」「以下」在正常句子里偶尔也会出现，按任务卡宁可丢一条也不放过。
 */
const META_WORDS =
  /角色|对方|用户|碎碎念|日记|人设|提示词|以下|好的|作为|第一人称|不超过|素材|输出|字数/u;
/**
 * 像在复述素材或指令：开头是「xx：」这样的标签（冒号后接数字的是时间，例「10:30」，不算），
 * 或复述了素材里的固定栏目名，或在数字数。
 */
const ECHO_PATTERNS = [
  /^[^，。！？!?\s]{1,8}[：:](?!\d)/u,
  /现在是周|我现在的状态|我的个性签名|我最近发的朋友圈|今天的事[：:]|刚才[：:]/u,
  /\d+\s*个?字/u,
];

/** 句末标点（截断点只能落在这些字符之后）。 */
const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '…', '~', '～']);
/** 句末标点后可以跟着的收尾符号（引号、括号），截断时一并保留。 */
const CLOSERS = new Set(['」', '』', '”', '’', '）', ')', '"']);
/** 没有句末标点时的退路：截在最后一个逗号 / 分号处，换成省略号。 */
const SOFT_BREAK = new Set(['，', ',', '；', ';', '、']);

const WEEKDAY = '日一二三四五六';

/** 当地小时 → 时段说法。 */
export function murmurDayPart(hour: number): string {
  if (hour < 5) return '深夜';
  if (hour < 8) return '清早';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  if (hour < 23) return '晚上';
  return '深夜';
}

export interface MurmurMaterialInput {
  /** 用户当地小时（0–23）。 */
  localHour: number;
  /** 用户当地星期（0 = 周日）。 */
  weekday: number;
  /** 角色在生态里的状态（只对该用户可见）。 */
  statusText?: string | null;
  /** 角色在生态里的个性签名。 */
  signature?: string | null;
  /** 角色自己最近发的朋友圈正文（新的在前）。 */
  recentPosts?: readonly string[];
  /** 今天角色自己经历的事（推演的日常、和其他角色的共同事件），已是角色视角的一句话。 */
  todayEvents?: readonly string[];
  /** 这次做了什么（自然语言，例「给你发了条消息」）；什么也没做传空数组。 */
  done: readonly string[];
}

/** 素材条目清洗：压空白、截短；含运营称呼或健康隐私的整条丢掉（返回 null），不改写。 */
function materialItem(text: string | null | undefined, max: number): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || MATERIAL_BANNED.test(t) || healthPrivate(t)) return null;
  return [...t].slice(0, max).join('');
}

/**
 * 组装碎碎念素材（第一人称自然语言）。只有时段、角色自己的生活和这次做了什么；
 * 绝不接收聊天计数、未回条数、上次主动多久前等运营指标（调用方也不该传 Jev 摘要进来）。
 */
export function buildMurmurMaterial(input: MurmurMaterialInput): string {
  const lines = [`现在是周${WEEKDAY[input.weekday] ?? ''}${murmurDayPart(input.localHour)}。`];
  const status = materialItem(input.statusText, 12);
  if (status) lines.push(`我现在的状态：${status}`);
  const signature = materialItem(input.signature, 30);
  if (signature) lines.push(`我的个性签名：${signature}`);
  const posts = (input.recentPosts ?? [])
    .map((p) => materialItem(p, 50))
    .filter((p): p is string => !!p)
    .slice(0, 2);
  for (const post of posts) lines.push(`我最近发的朋友圈：「${post}」`);
  const events = (input.todayEvents ?? [])
    .map((e) => materialItem(e, 60))
    .filter((e): e is string => !!e)
    .slice(0, 3);
  for (const event of events) lines.push(`今天的事：${event}`);
  const done = input.done.map((d) => materialItem(d, 40)).filter((d): d is string => !!d);
  lines.push(`刚才：${done.length ? done.join('；') : '看了看手机，没做什么'}`);
  return lines.join('\n');
}

/** 输出是否含元话语 / 像在复述指令（命中就丢弃）。 */
export function murmurLooksMeta(text: string): boolean {
  return META_WORDS.test(text) || ECHO_PATTERNS.some((re) => re.test(text));
}

/**
 * 截到 max 字以内，截断点落在句末标点（句末标点后的引号、括号一并保留）。
 * 没超长原样返回；超长但前 max 字里没有句末标点时，退到最后一个逗号 / 分号处换成「…」；
 * 都没有返回 null（宁可不写，也不留半句话）。
 */
export function truncateMurmur(text: string, max = MURMUR_MAX_CHARS): string | null {
  const chars = [...text];
  if (chars.length <= max) return text;
  const head = chars.slice(0, max);
  for (let i = head.length - 1; i >= 0; i--) {
    if (!SENTENCE_END.has(head[i]!)) continue;
    let end = i + 1;
    while (end < head.length && (SENTENCE_END.has(head[end]!) || CLOSERS.has(head[end]!))) end++;
    return head.slice(0, end).join('');
  }
  for (let i = head.length - 1; i > 0; i--) {
    if (SOFT_BREAK.has(head[i]!)) return `${head.slice(0, i).join('')}…`;
  }
  return null;
}

/**
 * 模型原始输出 → 可展示的碎碎念；返回 null = 丢弃（不重试、不写库）。
 * 去掉首尾引号、多行并成一段，命中元话语就丢，再按句末截断。
 */
export function finalizeMurmur(raw: string): string | null {
  const joined = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce(
      (acc, line) =>
        acc ? `${acc}${/[。！？!?…~～，,；;]$/u.test(acc) ? '' : '，'}${line}` : line,
      '',
    );
  const text = joined.replace(/^["“「『]+|["”」』]+$/gu, '').trim();
  if (!text || murmurLooksMeta(text)) return null;
  return truncateMurmur(text);
}
