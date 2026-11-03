/**
 * 站内角色搜索的聚合规则（T-20261104b；docs/refactor/24-character-search.md「排序」「同名」）。纯函数，不碰数据库。
 *
 * - 每个角色 / 作品单独一项，不按名字、头像或模型判断合并人物；唯一的合并是按 ID 关联：
 *   我从某个广场作品复制出的角色（plaza.adoptions 记录），和该作品算同一项，显示「去聊天」。
 * - 排序：文本相关性 → 明确选择的来源（prefer）→ 已添加 → 来源（官方、本人、广场）→ 热度 → 候选 ID。
 *   热度只在最后比较，热门同名者不会盖过精确匹配。
 * - 稳定游标：上一页最后一项的排序键（连同搜索词与 prefer），下一页取严格排在它后面的项。
 */
import { searchKey } from '../../../platform/index.js';

export type SiteSource = 'official' | 'plaza' | 'own';
export type SitePrefer = 'official' | 'plaza' | undefined;

export interface RankedCandidate {
  candidateId: string;
  source: SiteSource;
  name: string;
  score: number;
  added: boolean;
  heat: number;
}

/** 排序键：[分数, 是否首选来源, 是否已添加, 来源次序, 热度, 候选 ID]。 */
export type SortKey = [number, number, number, number, number, string];

const SOURCE_ORDER: Record<SiteSource, number> = { official: 0, own: 1, plaza: 2 };

function preferred(source: SiteSource, prefer: SitePrefer): boolean {
  if (prefer === 'official') return source === 'official';
  if (prefer === 'plaza') return source === 'plaza';
  return false;
}

export function sortKey(item: RankedCandidate, prefer: SitePrefer): SortKey {
  return [
    item.score,
    preferred(item.source, prefer) ? 1 : 0,
    item.added ? 1 : 0,
    SOURCE_ORDER[item.source],
    item.heat,
    item.candidateId,
  ];
}

/** 负数 = a 排在前面。 */
export function compareKeys(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return b[0] - a[0];
  if (a[1] !== b[1]) return b[1] - a[1];
  if (a[2] !== b[2]) return b[2] - a[2];
  if (a[3] !== b[3]) return a[3] - b[3];
  if (a[4] !== b[4]) return b[4] - a[4];
  return a[5] < b[5] ? -1 : a[5] > b[5] ? 1 : 0;
}

export function rankCandidates<T extends RankedCandidate>(items: T[], prefer: SitePrefer): T[] {
  return items
    .map((item) => ({ item, key: sortKey(item, prefer) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ item }) => item);
}

/** 名字（标准化后）相同、出现不止一次的候选：这些项都要附身份说明，查不到时显示「暂未核实身份」。 */
export function ambiguousIds(items: readonly RankedCandidate[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const key = searchKey(item.name);
    groups.set(key, [...(groups.get(key) ?? []), item.candidateId]);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}

interface CursorPayload {
  v: 1;
  q: string;
  p: string;
  k: SortKey;
}

export function encodeSearchCursor(queryKey: string, prefer: SitePrefer, key: SortKey): string {
  const payload: CursorPayload = { v: 1, q: queryKey, p: prefer ?? '', k: key };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** 解不开、或不是同一个搜索词 / prefer 的游标一律当作没有（从第一页开始），与广场其他列表一致。 */
export function decodeSearchCursor(
  cursor: string | undefined,
  queryKey: string,
  prefer: SitePrefer,
): SortKey | null {
  if (!cursor) return null;
  try {
    const raw = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;
    const k = raw.k;
    if (raw.v !== 1 || raw.q !== queryKey || raw.p !== (prefer ?? '') || !Array.isArray(k))
      return null;
    if (k.length !== 6 || !k.slice(0, 5).every((n) => typeof n === 'number' && Number.isFinite(n)))
      return null;
    if (typeof k[5] !== 'string') return null;
    return k as SortKey;
  } catch {
    return null;
  }
}

/** 已排好序的候选里，取游标之后的一页；nextCursor 由这一页最后一项给出（不管它的卡片稍后是否还读得到）。 */
export function pageAfter<T extends RankedCandidate>(
  ranked: T[],
  prefer: SitePrefer,
  after: SortKey | null,
  limit: number,
): { page: T[]; last: SortKey | null; more: boolean } {
  const start = after
    ? ranked.findIndex((item) => compareKeys(sortKey(item, prefer), after) > 0)
    : 0;
  if (start < 0) return { page: [], last: null, more: false };
  const page = ranked.slice(start, start + limit);
  const more = start + limit < ranked.length;
  const tail = page.at(-1);
  return { page, last: tail ? sortKey(tail, prefer) : null, more };
}

export interface TypoCandidate {
  text: string;
  kind: 'homophone' | 'edit';
  source: SiteSource;
}

/**
 * 「你是否想找」：同音优先、其次单处编辑；同一名字只给一次；已经出现在联想 / 结果里的名字不再建议。
 * 只在没有精确命中时调用（有精确命中就不打扰）。
 */
export function pickDidYouMean(
  typos: readonly TypoCandidate[],
  exclude: ReadonlySet<string>,
  limit: number,
): { text: string }[] {
  const kindOrder = { homophone: 0, edit: 1 } as const;
  const sorted = [...typos].sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      Array.from(a.text).length - Array.from(b.text).length ||
      (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
  );
  const seen = new Set(exclude);
  const out: { text: string }[] = [];
  for (const typo of sorted) {
    const key = searchKey(typo.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text: typo.text });
    if (out.length >= limit) break;
  }
  return out;
}

export interface SuggestHit {
  text: string;
  score: number;
  match: 'exact' | 'prefix' | 'pinyin' | 'initials' | 'contains';
  matchedTerm: { text: string; kind: 'alias' | 'keyword' | 'based_on' } | null;
  source: SiteSource;
}

export interface SuggestItem {
  text: string;
  match: SuggestHit['match'];
  matchedTerm: SuggestHit['matchedTerm'];
  sources: SiteSource[];
}

/**
 * 联想：按名字合并成一行（同名的不同人物在结果页才分开），一行记下名字出现在哪些来源；
 * 分数取最高的那一项，排序：分数 → 名字短的在前 → 名字。
 */
export function mergeSuggestions(hits: readonly SuggestHit[], limit: number): SuggestItem[] {
  const rows = new Map<string, { best: SuggestHit; sources: Set<SiteSource> }>();
  for (const hit of hits) {
    const key = searchKey(hit.text);
    if (!key) continue;
    const row = rows.get(key);
    if (!row) {
      rows.set(key, { best: hit, sources: new Set([hit.source]) });
      continue;
    }
    row.sources.add(hit.source);
    if (hit.score > row.best.score) row.best = hit;
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        b.best.score - a.best.score ||
        Array.from(a.best.text).length - Array.from(b.best.text).length ||
        (a.best.text < b.best.text ? -1 : a.best.text > b.best.text ? 1 : 0),
    )
    .slice(0, limit)
    .map(({ best, sources }) => ({
      text: best.text,
      match: best.match,
      matchedTerm: best.matchedTerm,
      sources: (['official', 'own', 'plaza'] as const).filter((s) => sources.has(s)),
    }));
}

/** 广场作品的一句身份说明：作者是谁、基于哪位官方角色改编（都是本站数据）。 */
export function plazaIdentity(input: {
  /** 作品种类；接收端容错读到的未知种类按原创处理。 */
  kind: string;
  basedOnPresetName: string | null;
  authorNickname: string | null;
  authorDeleted: boolean;
}): string {
  const author = input.authorDeleted
    ? '已注销用户'
    : (input.authorNickname ?? '').trim() || '匿名作者';
  if (input.kind === 'preset_variant' && input.basedOnPresetName)
    return `基于官方角色「${input.basedOnPresetName}」改编 · 作者 ${author}`;
  return `广场原创 · 作者 ${author}`;
}
