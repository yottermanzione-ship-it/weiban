/**
 * 站内角色搜索的文字处理（T-20261104b，docs/refactor/24-character-search.md「索引和身份」）。
 *
 * characters（官方 / 本人角色投影）与 plaza（广场作品投影、聚合层）共用同一套标准化与打分，
 * 两边的分数才能直接比较，所以放在平台内核，不放进任何一个模块。
 *
 * 规则（方案原文：标准化仅做 Unicode NFKC、大小写、连续空白和固定标点处理）：
 * - 比较键 = NFKC → 小写 → 去掉空白与标点（Unicode 标点类 P 和固定的 ~ ^ ` |）。
 *   不去姓氏、不去后缀、不做同义词：两个不同的人不会因为标准化变成同一个键以外的东西，
 *   键相同也只是「都命中」，结果里仍是两项，不合并。
 * - 拼音由 pinyin-pro（MIT，词典随包，本地计算）在服务端生成，用户输入也在本地转换，不发给第三方。
 * - 匹配分三层：精确名称 / 别名 → 前缀、完整拼音、拼音首字母（加包含）→ 有界的单处错字。
 *   错字层只产生「你是否想找」建议（typoKind），不进入结果、不改写搜索词。
 * - 2～3 字的短名字：精确与审核别名分数最高；错字只认同音字，不认任意替换（「李晨」不会提示「李明」）。
 */
import { pinyin } from 'pinyin-pro';

/** 参与匹配的最大字数（按 Unicode 码点）；更长的输入截断后只在站内搜。 */
export const SEARCH_QUERY_MAX_CHARS = 64;
/** 投影里每个词条的最大长度。 */
export const SEARCH_TERM_MAX_CHARS = 64;

/** 词条种类：名字、经审核的别名、关键词（代表作品 / 后台检索词）、广场作品「基于的角色」。 */
export type SearchTermKind = 'name' | 'alias' | 'keyword' | 'based_on';
/** 命中方式（契约 SiteSearchMatch）。 */
export type SearchMatch = 'exact' | 'prefix' | 'pinyin' | 'initials' | 'contains';

export interface SearchQuery {
  /** 标准化后的比较键（截断到 SEARCH_QUERY_MAX_CHARS）。 */
  key: string;
  /** 比较键的字数（码点）。 */
  chars: number;
  /** 只含 a-z0-9（可能是拼音、首字母或英文）。 */
  ascii: boolean;
  hasCjk: boolean;
  /** 含汉字时的完整拼音（同音错字建议用）；否则为空串。 */
  pinyin: string;
  /** 原输入超过上限被截断。 */
  tooLong: boolean;
}

export interface SearchTermRecord {
  key: string;
  kind: SearchTermKind;
  pinyin: string;
  initials: string;
}

export interface SearchScore {
  score: number;
  match: SearchMatch;
}

const STRIP = /[\s\p{P}~^`|]/gu;
const HAN = /\p{Script=Han}/u;

/** 标准化比较键。 */
export function searchKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(STRIP, '');
}

/** 词条的显示形式：NFKC、连续空白合一、去首尾空白、截断。 */
export function displayTerm(text: string): string {
  return Array.from(text.normalize('NFKC').replace(/\s+/gu, ' ').trim())
    .slice(0, SEARCH_TERM_MAX_CHARS)
    .join('');
}

function chars(text: string): number {
  return Array.from(text).length;
}

/** 完整拼音与首字母（都已标准化、无空格）；不含汉字时两者都是空串。 */
export function pinyinKeys(text: string): { pinyin: string; initials: string } {
  const source = text.normalize('NFKC');
  if (!HAN.test(source)) return { pinyin: '', initials: '' };
  const options = {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
    surname: 'head',
    v: true,
  } as const;
  const full = pinyin(source, options).map(searchKey).join('');
  const first = pinyin(source, { ...options, pattern: 'first' })
    .map(searchKey)
    .join('');
  return { pinyin: full, initials: first };
}

/** 用户输入 → 查询；标准化后为空返回 null（空白、只有标点）。 */
export function analyzeQuery(raw: string): SearchQuery | null {
  const full = Array.from(searchKey(raw));
  if (!full.length) return null;
  const tooLong = full.length > SEARCH_QUERY_MAX_CHARS;
  const key = full.slice(0, SEARCH_QUERY_MAX_CHARS).join('');
  const hasCjk = HAN.test(key);
  return {
    key,
    chars: Math.min(full.length, SEARCH_QUERY_MAX_CHARS),
    ascii: /^[a-z0-9]+$/u.test(key),
    hasCjk,
    pinyin: hasCjk ? pinyinKeys(key).pinyin : '',
    tooLong,
  };
}

/** 各层基础分；同层里补全得越短越靠前（最多扣 8 分，不会跌进下一层）。 */
const BASE = {
  exact: { name: 100, alias: 96, based_on: 90, keyword: 50 },
  prefix: { name: 80, alias: 76, based_on: 72, keyword: 45 },
  contains: { name: 60, alias: 56, based_on: 52, keyword: 38 },
} as const;
const PINYIN_EXACT = 74;
const INITIALS_EXACT = 72;
const PINYIN_PREFIX = 70;
const INITIALS_PREFIX = 66;

function completion(base: number, termChars: number, queryChars: number): number {
  return base - Math.min(8, Math.max(0, termChars - queryChars));
}

/**
 * 给一个词条打分；不命中返回 null。
 * 只有一个字时只认精确和前缀（关键词只认精确），不做拼音、首字母和包含，避免一个字拉出半个库。
 */
export function scoreTerm(q: SearchQuery, t: SearchTermRecord): SearchScore | null {
  const termChars = chars(t.key);
  if (t.key === q.key) return { score: BASE.exact[t.kind], match: 'exact' };
  const single = q.chars < 2;
  const candidates: SearchScore[] = [];
  if (t.key.startsWith(q.key) && !(single && t.kind === 'keyword'))
    candidates.push({
      score: completion(BASE.prefix[t.kind], termChars, q.chars),
      match: 'prefix',
    });
  if (!single && q.ascii && t.kind !== 'keyword') {
    if (t.pinyin && t.pinyin === q.key) candidates.push({ score: PINYIN_EXACT, match: 'pinyin' });
    else if (t.pinyin.startsWith(q.key) && t.pinyin)
      candidates.push({ score: PINYIN_PREFIX, match: 'pinyin' });
    if (t.initials && t.initials === q.key)
      candidates.push({ score: INITIALS_EXACT, match: 'initials' });
    else if (t.initials && t.initials.startsWith(q.key))
      candidates.push({ score: INITIALS_PREFIX, match: 'initials' });
  }
  if (!single && t.key.includes(q.key))
    candidates.push({
      score: completion(BASE.contains[t.kind], termChars, q.chars),
      match: 'contains',
    });
  if (!candidates.length) return null;
  return candidates.reduce((best, next) => (next.score > best.score ? next : best));
}

/** 受限的 Damerau-Levenshtein（相邻换位算一处）；超过 max 时返回 max + 1。按码点比较。 */
export function editDistance(a: string, b: string, max = 1): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (Math.abs(x.length - y.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= x.length; i++) {
    rows.push(Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  }
  for (let i = 1; i <= x.length; i++) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1])
        value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
  }
  return Math.min(rows[x.length]![y.length]!, max + 1);
}

/** 错字近似种类：同音字优先，其次单处编辑（替换 / 增删 / 相邻换位）。 */
export type TypoKind = 'homophone' | 'edit';

/**
 * 错字层（只作「你是否想找」）：名字、别名、基于的角色才参与，关键词不参与。
 * - 同音：含汉字、至少 2 字，完整拼音相同而字不同（「易洋千玺」→「易烊千玺」，「厉晨」→「李晨」）；
 *   至少 3 字时也认同音前缀（「易洋千」→「易烊千玺」）。
 * - 单处编辑：至少 3 字（2 字名字只认同音，避免「李晨」提示「李明」）；拼音 / 英文输入至少 4 个字母，
 *   也可以对词条的完整拼音算一处编辑（「yiyangqianxu」→「易烊千玺」）。
 * 已经是前缀命中的不算错字。
 */
export function typoKind(q: SearchQuery, t: SearchTermRecord): TypoKind | null {
  if (t.kind === 'keyword' || q.chars < 2 || t.key === q.key || t.key.startsWith(q.key))
    return null;
  if (q.hasCjk && t.pinyin && t.pinyin === q.pinyin) return 'homophone';
  if (q.hasCjk && q.chars >= 3 && q.pinyin && t.pinyin.startsWith(q.pinyin)) return 'homophone';
  const minEdit = q.ascii ? 4 : 3;
  if (q.chars < minEdit) return null;
  if (editDistance(t.key, q.key) === 1) return 'edit';
  if (q.ascii && t.pinyin && !t.pinyin.startsWith(q.key) && editDistance(t.pinyin, q.key) === 1)
    return 'edit';
  return null;
}

/** LIKE 模式转义（配合 ESCAPE '\'）。 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/gu, '\\$&');
}

/** 词条的投影字段（写投影时用）。 */
export function termRecord(
  text: string,
  kind: SearchTermKind,
): (SearchTermRecord & { term: string }) | null {
  const term = displayTerm(text);
  const key = Array.from(searchKey(term)).slice(0, SEARCH_TERM_MAX_CHARS).join('');
  if (!key) return null;
  return { term, key, kind, ...pinyinKeys(term) };
}

/** 同一来源里去重：同一个比较键只留优先级最高的词条（name > alias > based_on > keyword）。 */
export function uniqueTerms<T extends { key: string; kind: SearchTermKind }>(terms: T[]): T[] {
  const rank: Record<SearchTermKind, number> = { name: 0, alias: 1, based_on: 2, keyword: 3 };
  const out = new Map<string, T>();
  for (const term of terms) {
    const seen = out.get(term.key);
    if (!seen || rank[term.kind] < rank[seen.kind]) out.set(term.key, term);
  }
  return [...out.values()];
}
