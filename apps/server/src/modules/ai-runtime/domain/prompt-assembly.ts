/**
 * 私聊回复请求组装（docs/refactor/09-chat-pipeline.md 第 4 节）。纯函数，不碰数据库。
 *
 * 最终请求只有三种位置：
 *   ① 稳定开头（一条系统消息）：两次窗口推进之间一字不变，可以被上游前缀缓存命中；
 *   ② 聊天记录（摘要边界之后的原文），可在固定深度插入「角色笔记 / 作者注释」类短提示（酒馆的 @depth）；
 *   ③ 动态结尾（一条系统消息，放在最后一条用户消息之后）：每轮都会变的资料与本轮指令。
 * 区块之间用「【标题】」分隔，模型容易分清；空区块不输出。
 */
import type { ModelImageRef } from '@weiban/contracts';

export interface PromptSection {
  /** 区块标题；为空时不加标题行（例如平台守则正文自带说明）。 */
  title: string;
  text: string;
}

/** 在聊天记录里按深度插入的短提示：depth = 0 表示放在最后一条消息之后，N 表示倒数第 N 条消息之前。 */
export interface DepthInsert {
  depth: number;
  text: string;
  /** 同一深度多条时的先后（小的在前）。 */
  order: number;
}

/** H3：本轮附给模型看的图（一步看图）；blindContent = 模型看不到图时替换 content 的说法。只用于用户消息。 */
export interface TurnImages {
  images?: ModelImageRef[];
  blindContent?: string;
}

export interface ChatTurnMessage extends TurnImages {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssembledMessage extends TurnImages {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AssembleInput {
  /** 酒馆式占位符：{{user}} / {{userNickname}} → 用户称呼，{{char}} → 角色名。 */
  macros?: { user: string; char: string };
  head: PromptSection[];
  history: ChatTurnMessage[];
  inserts?: DepthInsert[];
  tail: PromptSection[];
}

export interface AssembleStats {
  headChars: number;
  historyChars: number;
  insertChars: number;
  tailChars: number;
  /**
   * 预计可命中前缀缓存的字符数：从开头到「第一处本轮新出现的内容」之前。
   * 本轮新内容 = 深度插入的提示、最后一段连续的用户消息、动态结尾。
   */
  stablePrefixChars: number;
}

export function renderSections(sections: PromptSection[]): string {
  return sections
    .map((s) => ({ title: s.title.trim(), text: s.text.trim() }))
    .filter((s) => s.text)
    .map((s) => (s.title ? `【${s.title}】\n${s.text}` : s.text))
    .join('\n\n');
}

export function assemblePrompt(input: AssembleInput): {
  messages: AssembledMessage[];
  stats: AssembleStats;
} {
  const fill = (text: string) =>
    input.macros
      ? text
          .replace(/\{\{\s*(?:user|userNickname)\s*\}\}/gi, input.macros.user)
          .replace(/\{\{\s*char\s*\}\}/gi, input.macros.char)
      : text;
  const head = fill(renderSections(input.head));
  const tail = fill(renderSections(input.tail));
  const history = input.history.filter((m) => m.content.trim());
  // 深度 → 插入位置（history 下标之前）。深度 0 的提示与动态结尾放在一起（都在最后）。
  const inserts = [...(input.inserts ?? [])]
    .filter((i) => i.text.trim())
    .sort((a, b) => b.depth - a.depth || a.order - b.order);
  const tailInserts = inserts.filter((i) => i.depth <= 0).map((i) => i.text.trim());
  const byIndex = new Map<number, string[]>();
  for (const i of inserts) {
    if (i.depth <= 0) continue;
    const at = Math.max(0, history.length - i.depth);
    byIndex.set(at, [...(byIndex.get(at) ?? []), i.text.trim()]);
  }
  const messages: AssembledMessage[] = [];
  if (head) messages.push({ role: 'system', content: head });
  const insertIndexes: number[] = [];
  history.forEach((m, idx) => {
    const notes = byIndex.get(idx);
    if (notes?.length) {
      insertIndexes.push(messages.length);
      messages.push({ role: 'system', content: notes.join('\n') });
    }
    messages.push({
      role: m.role,
      content: m.content,
      ...(m.role === 'user' && m.images?.length
        ? { images: m.images, ...(m.blindContent ? { blindContent: m.blindContent } : {}) }
        : {}),
    });
  });
  const tailText = [...tailInserts.map(fill), tail].filter(Boolean).join('\n\n');
  if (tailText) messages.push({ role: 'system', content: tailText });

  // 最后一段连续的用户消息（本轮新发的话）从哪开始
  let lastUserRun = messages.length - (tailText ? 1 : 0);
  while (lastUserRun - 1 >= 0 && messages[lastUserRun - 1]!.role === 'user') lastUserRun--;
  const firstVolatile = Math.min(
    lastUserRun,
    ...(insertIndexes.length ? insertIndexes : [Infinity]),
  );
  const stablePrefixChars = messages
    .slice(0, firstVolatile)
    .reduce((n, m) => n + m.content.length, 0);
  return {
    messages,
    stats: {
      headChars: head.length,
      historyChars: history.reduce((n, m) => n + m.content.length, 0),
      insertChars: inserts.reduce((n, i) => n + i.text.length, 0),
      tailChars: tailText.length,
      stablePrefixChars,
    },
  };
}

/** 去掉空值后用「；」连接，生成「标签：值」短行（替代 JSON，省 30%～40% token，模型也更好读）。 */
export function line(label: string, value: string | string[] | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = Array.isArray(value) ? value.filter(Boolean).join('、') : value.trim();
  return text ? `${label}：${text}` : null;
}

export function lines(items: (string | null | undefined | false)[]): string {
  return items.filter((v): v is string => typeof v === 'string' && v.length > 0).join('\n');
}

/** 按字符预算截断一组条目（整条保留，不截半句）。 */
export function takeWithin(items: string[], maxChars: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const item of items) {
    if (used + item.length > maxChars && out.length) break;
    out.push(item.length > maxChars ? item.slice(0, maxChars) : item);
    used += item.length + 1;
  }
  return out;
}

/** H3：附图在消息文字里的标记（〔图1〕…），尾标里的 n 与它对应。 */
export const IMAGE_MARKER = /〔图(\d+)〕/gu;

/**
 * H3：去掉附图。describe 给了（同一轮的重写调用已经解析出描述）且消息里每个标记都有描述 → 把标记换成描述，
 * 省去再看一次图的钱；否则（模型缺识图能力等）改用 blindContent（看不到图的说法）。
 */
export function withoutImages<T extends AssembledMessage>(
  messages: readonly T[],
  describe?: (n: number) => string | null,
): T[] {
  return messages.map((m) => {
    if (m.role === 'system' && !describe)
      return {
        ...m,
        content: m.content.replace(/【这一轮的图片】[\s\S]*?【图片存档要求结束】/gu, ''),
      };
    if (!m.images?.length) return m;
    const { images: _images, blindContent, ...rest } = m;
    void _images;
    if (describe) {
      let complete = true;
      let matched = false;
      const content = m.content.replace(IMAGE_MARKER, (_all, n: string) => {
        matched = true;
        const text = describe(Number(n));
        if (!text) complete = false;
        return text ? `：${text}` : '';
      });
      if (matched && complete) return { ...rest, content } as T;
    }
    return { ...rest, content: blindContent ?? m.content } as T;
  });
}
