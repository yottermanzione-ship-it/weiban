import { expect, it } from 'vitest';
import {
  groupCacheUsage,
  summarizeCacheUsage,
  type CacheUsageReportRow,
} from './cache-usage-report.js';

const row: CacheUsageReportRow = {
  purpose: 'chat_reply',
  modelKey: 'synthetic-model',
  upstreamId: 'opaque-account-a',
  upstreamModelId: 'model-a',
  conversationKind: 'direct',
  promptTemplateVersion: 'chat-v1',
  status: 'succeeded',
  estimated: false,
  inputTokens: 100,
  cachedInputTokens: 900,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheUsage: {
    version: 1,
    state: 'reported',
    source: 'openai',
    totalInputTokens: 1000,
    cachedInputTokens: 900,
  },
};

it('weights actual input tokens, excludes missing/invalid/old data from observed rate, and includes zero hits', () => {
  const rows: CacheUsageReportRow[] = [
    row,
    {
      ...row,
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheUsage: { ...(row.cacheUsage as object), totalInputTokens: 100, cachedInputTokens: 0 },
    },
    {
      ...row,
      inputTokens: 1000,
      cachedInputTokens: 0,
      cacheUsage: {
        version: 1,
        state: 'missing',
        source: null,
        totalInputTokens: 1000,
        cachedInputTokens: null,
      },
    },
    {
      ...row,
      inputTokens: 1000,
      cachedInputTokens: 0,
      cacheUsage: {
        version: 1,
        state: 'invalid',
        source: 'openai',
        totalInputTokens: 1000,
        cachedInputTokens: 1100,
      },
    },
    { ...row, inputTokens: 1000, cachedInputTokens: 0, cacheUsage: undefined },
  ];
  const summary = summarizeCacheUsage(rows);
  expect(summary.states).toEqual({ reported: 2, missing: 1, invalid: 1, notRecorded: 1 });
  expect(summary.reportedCallCoverage).toBe(2 / 5);
  expect(summary.reportedInputCoverage).toBe(1100 / 4100);
  expect(summary.reportedCacheHitRate).toBe(900 / 1100);
  expect(summary.zeroHitCalls).toBe(1);
  expect(summary.meanUncachedInputTokens).toBe(100);
  expect(summary.allCallsCacheHitRate).toBe(900 / 4100);
});

it('separates account, purpose, conversation kind and prompt template without returning account IDs', () => {
  const groups = groupCacheUsage([
    row,
    { ...row, upstreamId: 'opaque-account-b' },
    { ...row, purpose: 'simulation' },
    { ...row, conversationKind: 'group' },
    { ...row, promptTemplateVersion: 'question-of-day-v1' },
  ]);
  expect(groups).toHaveLength(5);
  expect(JSON.stringify(groups)).not.toContain('opaque-account');
  expect(groups[0]!.upstreamAccount).not.toBe(groups[1]!.upstreamAccount);
});

it('counts only allowlisted request changes and leaves empty ratios unknown', () => {
  const summary = summarizeCacheUsage([
    {
      ...row,
      promptCacheDiagnostic: {
        version: 1,
        status: 'compared',
        firstChange: 'head_changed',
        firstChangedSection: 'memory',
        routeChanged: true,
        modelChanged: false,
        sameTask: true,
        matchingTextPrefix: '256-1023',
        content: 'must never appear',
      },
    },
    {
      ...row,
      promptCacheDiagnostic: {
        version: 1,
        status: 'compared',
        firstChange: 'must never appear',
        firstChangedSection: 'must never appear',
      },
    },
  ]);
  expect(summary.prefixObservations.firstChangedSection.memory).toBe(1);
  expect(summary.prefixObservations.routeChanged).toBe(1);
  expect(summary.prefixObservations.comparedWithinTask).toBe(1);
  expect(summary.prefixObservations.matchingTextPrefix['256-1023']).toBe(1);
  expect(JSON.stringify(summary)).not.toContain('must never appear');
  expect(summarizeCacheUsage([]).reportedCacheHitRate).toBeNull();
});
