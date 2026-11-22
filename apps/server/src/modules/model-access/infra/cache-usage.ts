/** Cache diagnostics only. These fields never change billing quantities or provider requests. */
export interface CacheUsageDiagnostic {
  version: 1;
  state: 'reported' | 'missing' | 'invalid';
  source: 'openai' | 'deepseek' | 'anthropic' | null;
  /** Actual reported total input, including cache reads and writes; never an estimate. */
  totalInputTokens: number | null;
  cachedInputTokens: number | null;
}

const tokens = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function openAiCacheUsage(raw: unknown): CacheUsageDiagnostic {
  const usage = object(raw);
  const details = object(usage.prompt_tokens_details);
  // Match the adapter's DeepSeek-first normalization without confusing an explicit zero with absence.
  const deepseek = usage.prompt_cache_hit_tokens != null;
  const value = deepseek ? usage.prompt_cache_hit_tokens : details.cached_tokens;
  const total = tokens(usage.prompt_tokens);
  const read = tokens(value);
  const state =
    value == null
      ? 'missing'
      : read === null || total === null || read > total
        ? 'invalid'
        : 'reported';
  return {
    version: 1,
    state,
    source: deepseek ? 'deepseek' : value != null ? 'openai' : null,
    totalInputTokens: total,
    cachedInputTokens: read,
  };
}

export function anthropicCacheUsage(raw: Record<string, unknown>): CacheUsageDiagnostic {
  const read = tokens(raw.cache_read_input_tokens);
  const input = tokens(raw.input_tokens);
  const creation = tokens(raw.cache_creation_input_tokens);
  const detail = object(raw.cache_creation);
  const w5 = tokens(detail.ephemeral_5m_input_tokens);
  const w1 = tokens(detail.ephemeral_1h_input_tokens);
  const hasDetail = w5 !== null || w1 !== null;
  const write = hasDetail ? (w5 ?? 0) + (w1 ?? 0) : creation;
  const invalid =
    [
      raw.cache_read_input_tokens,
      raw.input_tokens,
      raw.cache_creation_input_tokens,
      detail.ephemeral_5m_input_tokens,
      detail.ephemeral_1h_input_tokens,
    ].some((value) => value != null && tokens(value) === null) ||
    (raw.cache_creation != null &&
      (typeof raw.cache_creation !== 'object' || Array.isArray(raw.cache_creation))) ||
    (creation !== null && hasDetail && creation !== write);
  const total = input !== null && read !== null && write !== null ? input + read + write : null;
  return {
    version: 1,
    state:
      invalid || (total !== null && !Number.isSafeInteger(total))
        ? 'invalid'
        : total === null
          ? 'missing'
          : 'reported',
    source: 'anthropic',
    totalInputTokens: total !== null && Number.isSafeInteger(total) ? total : null,
    cachedInputTokens: read,
  };
}

/** Old records have no observation. Do not retrospectively turn their normalized zero into a hit/miss. */
export function recordedCacheUsage(value: unknown): CacheUsageDiagnostic | null {
  const v = object(value);
  if (
    v.version !== 1 ||
    !['reported', 'missing', 'invalid'].includes(String(v.state)) ||
    !['openai', 'deepseek', 'anthropic', null].includes(v.source as string | null) ||
    (v.totalInputTokens !== null && tokens(v.totalInputTokens) === null) ||
    (v.cachedInputTokens !== null && tokens(v.cachedInputTokens) === null)
  )
    return null;
  const result = v as unknown as CacheUsageDiagnostic;
  if (
    result.state === 'reported' &&
    (result.totalInputTokens === null ||
      result.cachedInputTokens === null ||
      result.cachedInputTokens > result.totalInputTokens)
  )
    return null;
  return result;
}
