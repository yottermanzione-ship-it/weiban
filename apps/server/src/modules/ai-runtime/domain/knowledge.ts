import type { z } from 'zod';
import type { CardKnowledgeEntry } from '@weiban/contracts';
type Entry = z.infer<typeof CardKnowledgeEntry>;
/** 世界书只检索卡片权威条目；有效期/secondaryKeys/常驻项在代码执行。 */
export function publicKnowledge(
  entries: Entry[],
  text: string,
  localDate: string,
  realPerson: boolean,
): Entry[] {
  const query = text.normalize('NFKC').toLocaleLowerCase();
  const matched = (keys: string[]) =>
    keys.some((key) => key.trim() && query.includes(key.normalize('NFKC').toLocaleLowerCase()));
  return entries
    .filter((entry) => {
      if (realPerson && (entry.confidence === 'userSource' || entry.confidence === 'fictionCanon'))
        return false;
      if (entry.validFrom && entry.validFrom > localDate) return false;
      if (entry.validTo && entry.validTo < localDate) return false;
      return (
        entry.constant ||
        (matched(entry.keys) && (!entry.selective || matched(entry.secondaryKeys ?? [])))
      );
    })
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 16);
}

/**
 * 世界书式公开资料（docs/refactor/09-chat-pipeline.md 第 7.2 节，借鉴酒馆 World Info，只学设计）：
 * - 常驻条目（constant）进稳定开头，每次都带、位置不变；
 * - 关键词条目只在「扫描范围」（最近几条消息）里出现关键词时触发，放进动态结尾；
 * - 递归：已触发条目的正文也参与扫描，最多再扩 1 层（可关）；
 * - 预算：两部分各有字符上限，按优先级（priority 大的先）整条保留，超出就丢优先级低的；
 * - 真人角色不使用「用户提供 / 虚构设定」来源的条目；有效期在代码判断。
 */
export interface LorebookOptions {
  /** 稳定开头里常驻条目的字符上限。 */
  constantChars: number;
  /** 动态结尾里触发条目的字符上限。 */
  triggeredChars: number;
  /** 关键词二次扫描（递归）层数，0 = 关闭。 */
  recursionDepth: number;
}
export const DEFAULT_LOREBOOK: LorebookOptions = {
  constantChars: 900,
  triggeredChars: 1200,
  recursionDepth: 1,
};

export function lorebook(
  entries: Entry[],
  scanText: string,
  localDate: string,
  realPerson: boolean,
  options: LorebookOptions = DEFAULT_LOREBOOK,
  noRecursion: (entry: Entry) => boolean = () => false,
): { constant: Entry[]; triggered: Entry[] } {
  const usable = entries.filter((entry) => {
    if (realPerson && (entry.confidence === 'userSource' || entry.confidence === 'fictionCanon'))
      return false;
    if (entry.validFrom && entry.validFrom > localDate) return false;
    if (entry.validTo && entry.validTo < localDate) return false;
    return true;
  });
  const byPriority = (a: Entry, b: Entry) =>
    (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id);
  const constant = budget(usable.filter((e) => e.constant).sort(byPriority), options.constantChars);
  const norm = (v: string) => v.normalize('NFKC').toLocaleLowerCase();
  const hits = (keys: string[], text: string) =>
    keys.some((key) => key.trim() && text.includes(norm(key)));
  const fires = (entry: Entry, text: string) =>
    hits(entry.keys, text) && (!entry.selective || hits(entry.secondaryKeys ?? [], text));
  const pool = usable.filter((e) => !e.constant);
  const fired = new Set<Entry>();
  let scan = norm(scanText);
  for (let round = 0; round <= options.recursionDepth; round++) {
    const fresh = pool.filter((e) => !fired.has(e) && fires(e, scan));
    if (!fresh.length) break;
    for (const e of fresh) fired.add(e);
    // 下一轮只扫描本轮新触发、允许递归的条目正文
    scan = norm(
      fresh
        .filter((e) => !noRecursion(e))
        .map((e) => `${e.title}\n${e.content}`)
        .join('\n'),
    );
    if (!scan) break;
  }
  return { constant, triggered: budget([...fired].sort(byPriority), options.triggeredChars) };
}

function budget(entries: Entry[], maxChars: number): Entry[] {
  const out: Entry[] = [];
  let used = 0;
  for (const e of entries) {
    const size = e.title.length + e.content.length + 4;
    if (used + size > maxChars) continue;
    out.push(e);
    used += size;
  }
  return out;
}

/** 条目 → 短行（替代 JSON）。 */
export function lorebookText(entries: Entry[]): string {
  return entries.map((e) => `· ${e.title ? `${e.title}：` : ''}${e.content}`).join('\n');
}
