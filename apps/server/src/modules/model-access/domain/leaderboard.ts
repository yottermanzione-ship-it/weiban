/**
 * 3.24（试用反馈第二轮 F2 第 6 条）：榜单解析与相对名次（纯函数）。
 *
 * 来源有三种，都交给 parseLeaderboard：
 * 1. 服务器抓到的榜单网页：先找页面内嵌的 JSON（Next.js 数据、脚本里的对象数组），再找 HTML 表格；
 * 2. 后台粘贴的网页表格文本（浏览器复制出来是制表符分隔，或一格一行）；
 * 3. 后台上传 / 粘贴的 CSV（表头含「rank / 名次」与「model / 模型」列）。
 * 解析结果 = 模型名 → 原榜名次（同名取最好的名次）。匹配按「榜单对应名称」规范化后完全相同（不区分大小写、
 * 合并空白），不做模糊匹配，避免张冠李戴；匹配不到的模型在后台列出。
 */

export interface LeaderboardEntry {
  name: string;
  rank: number;
}

/** 最多保留的条目数（够覆盖整张榜）。 */
export const LEADERBOARD_MAX_ENTRIES = 2000;

/** 匹配用的规范化：去首尾空白、合并空白、小写。 */
export function normalizeArenaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const RANK_KEYS = ['rank', 'rank_ub', 'rankub', 'ranking', 'position', 'place', '名次', '排名'];
const NAME_KEYS = [
  'model',
  'modelname',
  'model_name',
  'modeldisplayname',
  'model_display_name',
  'displayname',
  'display_name',
  'name',
  '模型',
  '模型名',
];

function cleanName(raw: string): string | null {
  const name = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length > 120) return null;
  if (!/[a-z]/i.test(name)) return null; // 纯数字、符号不是模型名
  if (/^(rank|model|score|votes?|organization|license|名次|排名|模型|分数)\b/i.test(name)) return null;
  return name;
}

function rankOf(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 10_000 ? n : null;
}

function add(map: Map<string, LeaderboardEntry>, name: string | null, rank: number | null) {
  if (!name || rank === null) return;
  const key = normalizeArenaName(name);
  const old = map.get(key);
  if (!old || rank < old.rank) map.set(key, { name, rank });
}

/** JSON 里任何「同时有名次字段与模型名字段」的对象。 */
function fromJsonValue(value: unknown, map: Map<string, LeaderboardEntry>, depth = 0): void {
  if (depth > 12 || map.size >= LEADERBOARD_MAX_ENTRIES || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) fromJsonValue(item, map, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const lower = new Map(Object.keys(object).map((k) => [k.toLowerCase(), k]));
  const rankKey = RANK_KEYS.map((k) => lower.get(k)).find((k) => k !== undefined);
  const nameKey = NAME_KEYS.map((k) => lower.get(k)).find(
    (k) => k !== undefined && typeof object[k] === 'string',
  );
  if (rankKey && nameKey) add(map, cleanName(object[nameKey] as string), rankOf(object[rankKey]));
  for (const child of Object.values(object))
    if (child && typeof child === 'object') fromJsonValue(child, map, depth + 1);
}

/** 页面里的 JSON：<script> 内容整体是 JSON，或 Next.js 流式数据里转义过的 JSON 片段。 */
function fromEmbeddedJson(html: string, map: Map<string, LeaderboardEntry>): void {
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1]!.trim();
    if (body.startsWith('{') || body.startsWith('[')) {
      try {
        fromJsonValue(JSON.parse(body), map);
      } catch {
        /* 不是 JSON */
      }
    }
  }
  if (map.size) return;
  // 转义的对象片段：{\"rank\":1,...,\"modelDisplayName\":\"xxx\"...}
  const unescaped = html.replace(/\\"/g, '"');
  for (const m of unescaped.matchAll(/\{[^{}]{0,2000}\}/g)) {
    const text = m[0];
    if (!/"rank/i.test(text)) continue;
    try {
      fromJsonValue(JSON.parse(text), map);
    } catch {
      /* 片段不完整 */
    }
    if (map.size >= LEADERBOARD_MAX_ENTRIES) break;
  }
}

/** HTML 表格：每行第一个纯数字格 = 名次，其后第一个像模型名的格 = 模型名。 */
function fromHtmlTable(html: string, map: Map<string, LeaderboardEntry>): void {
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1]!.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    );
    fromCells(cells, map);
  }
}

function fromCells(cells: string[], map: Map<string, LeaderboardEntry>): boolean {
  const rankIndex = cells.findIndex((c) => rankOf(c) !== null);
  if (rankIndex < 0) return false;
  for (const cell of cells.slice(rankIndex + 1)) {
    const name = cleanName(cell);
    if (name) {
      add(map, name, rankOf(cells[rankIndex]));
      return true;
    }
  }
  return false;
}

/** 简单 CSV 一行（支持双引号）。 */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out.map((c) => c.trim());
}

/** CSV（有表头）：按表头找名次列与模型列。 */
function fromCsv(lines: string[], map: Map<string, LeaderboardEntry>): boolean {
  const header = csvCells(lines[0] ?? '').map((h) => h.toLowerCase().replace(/[\s()]/g, ''));
  const rankCol = header.findIndex((h) => RANK_KEYS.some((k) => h === k || h.startsWith(k)));
  const nameCol = header.findIndex((h) => NAME_KEYS.some((k) => h === k));
  if (rankCol < 0 || nameCol < 0) return false;
  for (const line of lines.slice(1)) {
    const cells = csvCells(line);
    add(map, cleanName(cells[nameCol] ?? ''), rankOf(cells[rankCol]));
  }
  return map.size > 0;
}

/** 纯文本（网页复制）：制表符 / 多个空格分隔的行；或「名次一行、模型名下一行」。 */
function fromPlainText(lines: string[], map: Map<string, LeaderboardEntry>): void {
  for (const line of lines) {
    const cells = line.split(/\t| {2,}|\|/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) fromCells(cells, map);
  }
  if (map.size) return;
  for (let i = 0; i < lines.length - 1; i++) {
    const rank = rankOf(lines[i]);
    if (rank === null) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (rankOf(lines[j]) !== null) continue; // 第二个名次列（例 按风格控制的名次）
      const name = cleanName(lines[j]!);
      if (name) {
        add(map, name, rank);
        break;
      }
    }
  }
}

/** 解析榜单（网页 HTML、粘贴文本或 CSV）。解析不出返回空数组。 */
export function parseLeaderboard(input: string): LeaderboardEntry[] {
  const map = new Map<string, LeaderboardEntry>();
  const text = input.replace(/^﻿/, '');
  if (/<html|<table|<script/i.test(text)) {
    fromEmbeddedJson(text, map);
    if (!map.size) fromHtmlTable(text, map);
  } else {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        fromJsonValue(JSON.parse(trimmed), map);
      } catch {
        /* 不是 JSON，按文本解析 */
      }
    }
    if (!map.size) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (!(lines[0]?.includes(',') && fromCsv(lines, map))) fromPlainText(lines, map);
    }
  }
  return [...map.values()]
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, LEADERBOARD_MAX_ENTRIES);
}

/** 抓到的页面是不是人机验证 / 拦截页（Cloudflare 等）。 */
export function looksLikeBotChallenge(status: number, body: string): boolean {
  return (
    status === 403 ||
    status === 503 ||
    /Just a moment\.\.\.|challenges\.cloudflare\.com|cf-chl|Attention Required/i.test(body.slice(0, 20_000))
  );
}

/**
 * 相对名次：有原榜名次的模型按名次升序（同名次按给定顺序）重新编号 1、2、3…N。
 * 例 原榜第 1、3、4、9 名 → 1、2、3、4。返回 模型键 → 相对名次。
 */
export function relativeRanks(
  items: ReadonlyArray<{ key: string; rank: number | null }>,
): Map<string, number> {
  const ranked = items
    .map((item, index) => ({ ...item, index }))
    .filter((item): item is { key: string; rank: number; index: number } => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  return new Map(ranked.map((item, i) => [item.key, i + 1]));
}
