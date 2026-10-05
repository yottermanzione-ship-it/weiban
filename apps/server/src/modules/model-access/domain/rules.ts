/**
 * model-access 的纯规则（无数据库、无网络），单元测试见 rules.test.ts。
 * 依据：billing.md 第 3、9 节；security-and-privacy.md 3.2；docs/ai/model-catalog.md 第 2 节；
 * docs/ai/cost-estimate.md 7.2 节（「约每条回复」与价格档位）。
 */
import type { ModelCapability, UpstreamStatus } from '@weiban/contracts';

export type UpstreamTestFailure =
  | 'invalid_key'
  | 'insufficient_balance'
  | 'network_error'
  | 'provider_error';

/** 契约 ModelRefState.unavailableReason。 */
export type UnavailableReason = 'model_removed' | 'provider_unavailable';

// ---------- 密钥 ----------

/** 密钥去除首尾空白；去除后仍须 8～512 字（契约 CreateUpstreamRequest.apiKey）。 */
export function normalizeApiKey(raw: string): string | null {
  const key = raw.trim();
  if (key.length < 8 || key.length > 512) return null;
  return key;
}

/**
 * 掩码：前 4 后 4 位（security-and-privacy.md 3.2 第 1 条）。
 * 短密钥（< 16 字）时 4 + 4 会暴露一半以上，按长度缩到 3 + 3 / 2 + 2，保证至少一半看不见。
 */
export function maskParts(key: string): { prefix: string; suffix: string } {
  const n = key.length >= 16 ? 4 : key.length >= 12 ? 3 : 2;
  return { prefix: key.slice(0, n), suffix: key.slice(-n) };
}

export function formatMask(prefix: string, suffix: string): string {
  return `${prefix}…${suffix}`;
}

/** 上游密钥加密的附加认证数据（security-and-privacy.md 3.1）。 */
export function upstreamAad(upstreamId: string): string {
  return `upstream:${upstreamId}`;
}

// ---------- 连通测试 ----------

/** 连通测试的 HTTP 状态码 → 失败类别（契约 UpstreamTestFailure）。 */
export function classifyTestStatus(httpStatus: number): UpstreamTestFailure | null {
  if (httpStatus >= 200 && httpStatus < 300) return null;
  if (httpStatus === 401 || httpStatus === 403) return 'invalid_key';
  if (httpStatus === 402) return 'insufficient_balance';
  return 'provider_error';
}

/** 连通测试结果 → 上游状态（billing.md 3.1 第 5 条）。 */
export function statusAfterTest(failure: UpstreamTestFailure | null): UpstreamStatus {
  switch (failure) {
    case null:
      return 'active';
    case 'invalid_key':
      return 'invalid';
    case 'insufficient_balance':
      return 'quota_exhausted';
    default:
      return 'unavailable';
  }
}

/**
 * 接口地址规则：必须是 http(s)；生产环境只允许 https（密钥会随请求发出，明文 http 会泄露），
 * 不允许地址里带账号密码或查询串、片段（避免把凭据放进地址）。
 */
export function checkBaseUrl(raw: string, production: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.toString().replace(/\/+$/, '');
}

// ---------- 模型目录 ----------

export interface CatalogFacts {
  enabled: boolean;
  capabilities: readonly string[];
}

export function hasAdultContent(capabilities: readonly string[]): boolean {
  return capabilities.includes('adult_content' satisfies ModelCapability);
}

/**
 * 某个模型对用户是否可用：目录里存在且启用 → 上游 active。
 * 返回 null = 可用；否则为不可用原因（契约 ModelRefState.unavailableReason）。
 */
export function unavailableReason(
  entry: CatalogFacts | null,
  upstreamStatus: UpstreamStatus | null,
): UnavailableReason | null {
  if (!entry || !entry.enabled) return 'model_removed';
  if (upstreamStatus !== 'active') return 'provider_unavailable';
  return null;
}

// ---------- 价格档位 ----------

/** 一个模型的文本单价（微元 / 百万 token，取最高的时段价，偏保守）。 */
export interface ModelTextPrices {
  inputPerMillionMicros: number;
  /** 没有单独的缓存价时为 null，按未命中价算（cost-estimate.md 7.2）。 */
  cachedInputPerMillionMicros: number | null;
  outputPerMillionMicros: number;
}

/** 「标准回复」用量（cost-estimate.md 7.2，唯一定义处在该文；这里是它在代码里的映射）。 */
export const STANDARD_REPLY = { inputTokens: 5000, cachedInputTokens: 3000, outputTokens: 150 };

/** 价格档位阈值（model-catalog.md 第 2 节）：便宜 < 0.015 元；较贵 > 0.06 元。 */
export const PRICE_TIER_CHEAP_BELOW_MICROS = 15_000;
export const PRICE_TIER_EXPENSIVE_ABOVE_MICROS = 60_000;

/** 约每条回复（微元，向上取整）。 */
export function standardReplyMicros(p: ModelTextPrices): number {
  const cached = p.cachedInputPerMillionMicros ?? p.inputPerMillionMicros;
  return Math.ceil(
    (STANDARD_REPLY.inputTokens * p.inputPerMillionMicros +
      STANDARD_REPLY.cachedInputTokens * cached +
      STANDARD_REPLY.outputTokens * p.outputPerMillionMicros) /
      1_000_000,
  );
}

export type PriceTier = 'cheap' | 'medium' | 'expensive';

/** 没有价格时返回 'medium'（中性显示；没有价格的模型网关会拒绝调用，见 billing.md 4.2）。 */
export function priceTier(prices: ModelTextPrices | undefined): PriceTier {
  if (!prices) return 'medium';
  const micros = standardReplyMicros(prices);
  if (micros < PRICE_TIER_CHEAP_BELOW_MICROS) return 'cheap';
  if (micros > PRICE_TIER_EXPENSIVE_ABOVE_MICROS) return 'expensive';
  return 'medium';
}

// ---------- 用量查询 ----------

/** 北京时间（与平台每日上限、供应商账单日一致，billing.md 10.1 第 4 条）。 */
export const USAGE_DAY_TIME_ZONE = 'Asia/Shanghai';

/** 列表游标：(created_at, id) 的 base64url。 */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [at, id] = parsed as unknown[];
    if (typeof at !== 'string' || typeof id !== 'string') return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const createdAt = new Date(at);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
