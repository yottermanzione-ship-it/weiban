import type { AdminUsageCacheReceipts } from '@weiban/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { generationAttempts, usageRecords } from '../infra/db/schema.js';

const normalizedInput = sql`(
  ${usageRecords.inputTokens}::bigint + ${usageRecords.cachedInputTokens}
  + ${usageRecords.cacheWrite5mTokens} + ${usageRecords.cacheWrite1hTokens}
)`;
const observation = sql`cache_attempt.receipt->'cacheUsage'`;
const legacy = sql`cache_attempt.receipt->'reported'`;

// The native Anthropic adapter used to fill absent read/write fields with zeros.
// Only the older OpenAI-compatible receipts can be interpreted unambiguously.
const hasLegacy = sql`(jsonb_typeof(${legacy}) = 'object' and not (${legacy} ? 'cacheWriteTokens'))`;
const hasObservation = sql`(${observation} is not null and ${observation} <> 'null'::jsonb)`;

const jsonNumber = (value: SQL) =>
  sql`case when jsonb_typeof(${value}) = 'number' then (${value})::numeric end`;

const valid = sql`(
  measured.input_tokens between 1 and 9007199254740991
  and measured.cached_tokens between 0 and measured.input_tokens
  and trunc(measured.input_tokens) = measured.input_tokens
  and trunc(measured.cached_tokens) = measured.cached_tokens
)`;

// A usage row can have several attempt rows after recovery. Link only its latest
// finished text attempt so calls, tokens, and the existing cost totals add up once.
export const CACHE_RECEIPT_JOINS = sql`
  left join lateral (
    select ${generationAttempts.id} as id, ${generationAttempts.reportedUsage} as receipt,
           ${generationAttempts.boundSnapshot}->'promptCacheDiagnostic' as diagnostic
    from ${generationAttempts}
    where ${generationAttempts.usageRecordId} = ${usageRecords.id}
      and ${generationAttempts.phase} = 'finished' and ${generationAttempts.boundSnapshot} ? 'ceiling'
    order by ${generationAttempts.finishedAt} desc nulls last,
             ${generationAttempts.createdAt} desc, ${generationAttempts.id} desc
    limit 1
  ) cache_attempt on ${usageRecords.mediaUnits} is null
  cross join lateral (
    select
      case when ${hasObservation} then ${observation}->'totalInputTokens'
           when ${hasLegacy} then ${legacy}->'promptTokens' end as input_value,
      case when ${hasObservation} then ${observation}->'cachedInputTokens'
           when ${hasLegacy} then ${legacy}->'cachedTokens' end as cached_value
  ) raw_cache
  cross join lateral (
    select ${jsonNumber(sql`raw_cache.input_value`)} as input_tokens,
           ${jsonNumber(sql`raw_cache.cached_value`)} as cached_tokens
  ) measured
  cross join lateral (
    select case
      when ${observation}->'version' = '1'::jsonb then case
        when ${observation}->>'state' in ('missing','invalid') then ${observation}->>'state'
        when ${observation}->>'state' = 'reported' and ${valid} then 'reported'
        else 'invalid' end
      when not coalesce(${hasObservation}, false) and ${hasLegacy} then case
        when raw_cache.cached_value is null or raw_cache.cached_value = 'null'::jsonb then 'missing'
        when ${valid} then 'reported'
        else 'invalid' end
      end as state
  ) cache_receipt`;

const textUsage = sql`(
  ${usageRecords.mediaUnits} is null and (cache_attempt.id is not null or ${normalizedInput} > 0)
)`;
const reported = sql`cache_receipt.state = 'reported'`;

export const CACHE_RECEIPT_TOTALS = sql`
  count(*) filter (where ${reported} and measured.cached_tokens > 0) as cache_hit_calls,
  count(*) filter (where ${reported} and measured.cached_tokens = 0) as cache_zero_calls,
  count(*) filter (where cache_receipt.state = 'missing') as cache_missing_calls,
  count(*) filter (where cache_receipt.state = 'invalid') as cache_invalid_calls,
  count(*) filter (where ${textUsage} and cache_receipt.state is null) as cache_unrecorded_calls,
  sum(${normalizedInput}) filter (where ${textUsage}) as cache_all_input,
  sum(${normalizedInput}) filter (where ${reported}) as cache_covered_input,
  sum(measured.input_tokens) filter (where ${reported}) as cache_reported_input,
  sum(measured.cached_tokens) filter (where ${reported}) as cache_reported_read,
  round(avg(measured.input_tokens - measured.cached_tokens)
    filter (where ${reported} and ${usageRecords.status} = 'succeeded')) as cache_mean_uncached`;

export type CacheReceiptTotalsRow = Record<
  | 'cache_hit_calls'
  | 'cache_zero_calls'
  | 'cache_missing_calls'
  | 'cache_invalid_calls'
  | 'cache_unrecorded_calls'
  | 'cache_all_input'
  | 'cache_covered_input'
  | 'cache_reported_input'
  | 'cache_reported_read'
  | 'cache_mean_uncached',
  string | number | null
>;

export function toCacheReceiptTotals(row: CacheReceiptTotalsRow): AdminUsageCacheReceipts {
  const input = Number(row.cache_reported_input);
  const total = Number(row.cache_all_input);
  return {
    hitRate: input ? Number(row.cache_reported_read) / input : null,
    inputCoverage: total ? Number(row.cache_covered_input) / total : null,
    hitCalls: Number(row.cache_hit_calls),
    zeroCalls: Number(row.cache_zero_calls),
    missingCalls: Number(row.cache_missing_calls),
    invalidCalls: Number(row.cache_invalid_calls),
    unrecordedCalls: Number(row.cache_unrecorded_calls),
    meanUncachedInputTokens:
      row.cache_mean_uncached === null ? null : Number(row.cache_mean_uncached),
  };
}
