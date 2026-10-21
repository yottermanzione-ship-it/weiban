/**
 * 3.26（G3-1）：models.dev 公开模型目录的解析与按模型名匹配（纯函数，不联网）。
 *
 * 数据源：https://models.dev/api.json（开源项目 sst/models.dev）。结构：
 *   { [providerId]: { id, name, models: { [modelId]: { id, name, attachment?, modalities?: { input: string[] },
 *     limit?: { context, output }, cost?: { input, output, cache_read?, cache_write? } } } } }
 * cost 单位是「美元 / 百万 token」；limit 单位是 token。
 *
 * 只保留预填需要的字段（压缩后约 1MB），存数据库缓存，后台检索在内存里做。
 */
import type { ModelsDevMatch, ModelsDevPrice } from '@weiban/contracts';

export const MODELS_DEV_URL = 'https://models.dev/api.json';
export const DEFAULT_USD_CNY_RATE = 7.2;

/** 压缩后的一条模型（字段名缩短，减少缓存体积）。 */
export interface CompactModel {
  /** providerId */
  p: string;
  /** modelId（服务商那边的原名） */
  id: string;
  /** 显示名 */
  n: string;
  /** 价格（美元 / 百万 token）：输入、输出、缓存读取、缓存写入；缺的为 null。 */
  c: [number | null, number | null, number | null, number | null] | null;
  /** 上下文长度、最大输出 */
  ctx: number | null;
  out: number | null;
  /** 输入支持图片：true / false / null（没写） */
  img: boolean | null;
}

export interface ModelsDevIndex {
  providers: Record<string, string>;
  models: CompactModel[];
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;

/** 把 api.json 解析成压缩索引；结构不对抛出带中文原因的错误。 */
export function compactModelsDev(raw: unknown): ModelsDevIndex {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('models.dev 返回的数据格式不对（不是服务商列表）');
  const providers: Record<string, string> = {};
  const models: CompactModel[] = [];
  for (const [providerKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const provider = value as Record<string, unknown>;
    const pid = typeof provider.id === 'string' && provider.id ? provider.id : providerKey;
    const list = provider.models;
    if (!list || typeof list !== 'object') continue;
    providers[pid] =
      typeof provider.name === 'string' && provider.name ? provider.name.slice(0, 80) : pid;
    for (const [modelKey, m] of Object.entries(list as Record<string, unknown>)) {
      if (!m || typeof m !== 'object') continue;
      const model = m as Record<string, unknown>;
      const id = (typeof model.id === 'string' && model.id ? model.id : modelKey).slice(0, 200);
      const cost =
        model.cost && typeof model.cost === 'object'
          ? (model.cost as Record<string, unknown>)
          : null;
      const limit =
        model.limit && typeof model.limit === 'object'
          ? (model.limit as Record<string, unknown>)
          : null;
      const modalities =
        model.modalities && typeof model.modalities === 'object'
          ? (model.modalities as Record<string, unknown>)
          : null;
      const inputs = Array.isArray(modalities?.input) ? (modalities.input as unknown[]) : null;
      const price: CompactModel['c'] = cost
        ? [num(cost.input), num(cost.output), num(cost.cache_read), num(cost.cache_write)]
        : null;
      models.push({
        p: pid,
        id,
        n: (typeof model.name === 'string' && model.name ? model.name : id).slice(0, 120),
        c: price && price.some((v) => v !== null) ? price : null,
        ctx: posInt(limit?.context),
        out: posInt(limit?.output),
        img: inputs ? inputs.includes('image') : null,
      });
    }
  }
  if (!models.length) throw new Error('models.dev 返回的数据里没有模型');
  return { providers, models };
}

/**
 * 模型名规范化：小写；去掉「服务商/」前缀与「:free」之类后缀；空格、下划线、点号统一成连字符
 * （claude-opus-4.6 与 claude-opus-4-6 视为同一个）。
 */
export function normalizeModelName(name: string): string {
  let s = name.trim().toLowerCase();
  if (s.includes('/')) s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/^~/, '');
  if (s.includes(':')) s = s.slice(0, s.indexOf(':'));
  return s
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** 宽松匹配：再去掉日期、latest 等后缀（claude-sonnet-4-5-20250929 → claude-sonnet-4-5）。 */
export function looseModelName(normalized: string): string {
  return normalized
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/, '')
    .replace(/-(latest|preview|exp|experimental)$/, '')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/, '');
}

/** 出品方 / 上游前缀 → models.dev 的官方服务商 ID。 */
const VENDOR_PROVIDERS: Array<[RegExp, string[]]> = [
  [/谷歌|google|gemini|gemma/i, ['google', 'google-vertex']],
  [/anthropic|claude/i, ['anthropic']],
  [/openai|gpt|^o\d/i, ['openai']],
  [/深度求索|deepseek/i, ['deepseek']],
  [/月之暗面|moonshot|kimi/i, ['moonshotai', 'moonshotai-cn']],
  [/智谱|zhipu|glm|z-?ai/i, ['zhipuai', 'zai']],
  [/阿里|通义|百炼|qwen|dashscope|alibaba/i, ['alibaba', 'alibaba-cn']],
  [/小米|xiaomi|mimo/i, ['xiaomi']],
  [/^x\.?ai$|grok/i, ['xai']],
  [/minimax|稀宇/i, ['minimax', 'minimax-cn']],
  [/mistral/i, ['mistral']],
  [/meta|llama/i, ['llama', 'meta']],
  [/字节|豆包|doubao|bytedance|volc/i, ['volcengine', 'bytedance']],
  [/cohere|command/i, ['cohere']],
];

/** 官方（首发）服务商：同名条目多时优先这些，再其次是有价格的条目。 */
const FIRST_PARTY = new Set(VENDOR_PROVIDERS.flatMap(([, ids]) => ids));

function vendorProviders(...hints: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const hint of hints) {
    const raw = (hint ?? '').trim();
    if (!raw) continue;
    for (const [re, ids] of VENDOR_PROVIDERS) if (re.test(raw)) out.push(...ids);
  }
  return out;
}

export interface ModelsDevLookupIndex {
  exact: Map<string, CompactModel[]>;
  loose: Map<string, CompactModel[]>;
  providers: Record<string, string>;
}

export function buildLookupIndex(index: ModelsDevIndex): ModelsDevLookupIndex {
  const exact = new Map<string, CompactModel[]>();
  const loose = new Map<string, CompactModel[]>();
  const push = (map: Map<string, CompactModel[]>, key: string, m: CompactModel) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  };
  for (const m of index.models) {
    const n = normalizeModelName(m.id);
    push(exact, n, m);
    push(loose, looseModelName(n), m);
  }
  return { exact, loose, providers: index.providers };
}

function pickBest(candidates: CompactModel[], preferred: string[]): CompactModel {
  const score = (m: CompactModel) => {
    const pref = preferred.indexOf(m.p);
    return (
      (pref >= 0 ? 1000 - pref : 0) +
      (FIRST_PARTY.has(m.p) ? 100 : 0) +
      (m.c ? 10 : 0) +
      (m.ctx ? 2 : 0) +
      (m.out ? 1 : 0)
    );
  };
  return [...candidates].sort((a, b) => score(b) - score(a) || a.p.localeCompare(b.p))[0]!;
}

const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

export function toCny(price: ModelsDevPrice, rate: number): ModelsDevPrice {
  const f = (v: number | null) => (v === null ? null : Math.min(100_000, round4(v * rate)));
  return {
    input: f(price.input),
    output: f(price.output),
    cacheRead: f(price.cacheRead),
    cacheWrite: f(price.cacheWrite),
  };
}

/** 按模型名（可带出品方）找最合适的一条；找不到返回 null。 */
export function lookupModel(
  index: ModelsDevLookupIndex,
  name: string,
  vendor: string | undefined,
  rate: number,
): ModelsDevMatch | null {
  const normalized = normalizeModelName(name);
  if (!normalized) return null;
  const prefix = name.includes('/') ? name.slice(0, name.indexOf('/')) : undefined;
  const preferred = vendorProviders(vendor, prefix, normalized);
  let exact = true;
  let candidates = index.exact.get(normalized) ?? [];
  if (!candidates.length) {
    exact = false;
    candidates = index.loose.get(looseModelName(normalized)) ?? [];
  }
  if (!candidates.length) return null;
  const best = pickBest(candidates, preferred);
  const priceUsd: ModelsDevPrice = {
    input: best.c?.[0] ?? null,
    output: best.c?.[1] ?? null,
    cacheRead: best.c?.[2] ?? null,
    cacheWrite: best.c?.[3] ?? null,
  };
  return {
    providerId: best.p,
    providerName: index.providers[best.p] ?? best.p,
    modelId: best.id,
    name: best.n,
    exact,
    alternatives: candidates.length - 1,
    priceUsd,
    priceCny: toCny(priceUsd, rate),
    contextTokens: best.ctx,
    maxOutputTokens: best.out,
    supportsImage: best.img,
  };
}
