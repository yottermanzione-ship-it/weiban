import { createHash } from 'node:crypto';
import { recordedCacheUsage } from '../infra/cache-usage.js';

/** Only allowlisted usage metadata enters the report; no identity, prompt, credential or URL fields. */
export interface CacheUsageReportRow {
  purpose: string;
  modelKey: string;
  upstreamId: string;
  upstreamModelId: string;
  conversationKind: string | null;
  promptTemplateVersion: string | null;
  status: string;
  estimated: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheUsage: unknown;
  promptCacheDiagnostic?: unknown;
}

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? numerator / denominator : null;

function summarizePrefixObservations(rows: CacheUsageReportRow[]) {
  const status = { first_observation: 0, compared: 0, unscoped: 0, oversized: 0 };
  const firstChange = {
    identical: 0,
    append_only: 0,
    head_changed: 0,
    history_window_advanced: 0,
    history_system_changed: 0,
    history_message_changed: 0,
    turn_or_dynamic_tail: 0,
    request_structure_changed: 0,
  };
  const firstChangedSection = {
    intro: 0,
    platform: 0,
    persona: 0,
    speech: 0,
    examples: 0,
    knowledge: 0,
    relationship: 0,
    care: 0,
    scenario: 0,
    author_supplement: 0,
    self_reports: 0,
    memory: 0,
    episodes: 0,
    date: 0,
    structure: 0,
  };
  let routeChanged = 0,
    modelChanged = 0,
    notRecorded = 0;
  for (const row of rows) {
    const value = row.promptCacheDiagnostic;
    if (!value || typeof value !== 'object') {
      notRecorded++;
      continue;
    }
    const d = value as Record<string, unknown>;
    if (d.version !== 1 || typeof d.status !== 'string' || !Object.hasOwn(status, d.status)) {
      notRecorded++;
      continue;
    }
    status[d.status as keyof typeof status]++;
    if (typeof d.firstChange === 'string' && Object.hasOwn(firstChange, d.firstChange))
      firstChange[d.firstChange as keyof typeof firstChange]++;
    if (
      typeof d.firstChangedSection === 'string' &&
      Object.hasOwn(firstChangedSection, d.firstChangedSection)
    )
      firstChangedSection[d.firstChangedSection as keyof typeof firstChangedSection]++;
    if (d.routeChanged === true) routeChanged++;
    if (d.modelChanged === true) modelChanged++;
  }
  return { status, firstChange, firstChangedSection, routeChanged, modelChanged, notRecorded };
}

export function summarizeCacheUsage(rows: CacheUsageReportRow[]) {
  const states = { reported: 0, missing: 0, invalid: 0, notRecorded: 0 };
  let inputTokens = 0,
    cachedTokens = 0,
    coveredInputTokens = 0,
    reportedInputTokens = 0,
    reportedCachedTokens = 0;
  for (const row of rows) {
    const total =
      row.inputTokens + row.cachedInputTokens + row.cacheWrite5mTokens + row.cacheWrite1hTokens;
    inputTokens += total;
    cachedTokens += row.cachedInputTokens;
    const observation = recordedCacheUsage(row.cacheUsage);
    if (!observation) states.notRecorded++;
    else {
      states[observation.state]++;
      if (observation.state === 'reported') {
        coveredInputTokens += total;
        reportedInputTokens += observation.totalInputTokens!;
        reportedCachedTokens += observation.cachedInputTokens!;
      }
    }
  }
  return {
    calls: rows.length,
    succeededCalls: rows.filter((row) => row.status === 'succeeded').length,
    estimatedCalls: rows.filter((row) => row.estimated).length,
    states,
    normalizedInputTokens: inputTokens,
    normalizedCachedTokens: cachedTokens,
    reportedInputTokens,
    reportedCachedTokens,
    reportedCallCoverage: ratio(states.reported, rows.length),
    // Coverage uses normalized amounts on both sides so estimates cannot make it exceed 100%.
    reportedInputCoverage: ratio(coveredInputTokens, inputTokens),
    reportedCacheHitRate: ratio(reportedCachedTokens, reportedInputTokens),
    allCallsCacheHitRate: ratio(cachedTokens, inputTokens),
    // These are local request comparisons, not provider-reported cache hits.
    prefixObservations: summarizePrefixObservations(rows),
  };
}

export function groupCacheUsage(rows: CacheUsageReportRow[]) {
  const groups = new Map<string, CacheUsageReportRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([
      row.purpose,
      row.modelKey,
      row.upstreamId,
      row.upstreamModelId,
      row.conversationKind,
      row.promptTemplateVersion,
    ]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const row = group[0]!;
    return {
      purpose: row.purpose,
      modelKey: row.modelKey,
      // An upstream is one configured account/credential. Never expose its key, label or address.
      upstreamAccount: createHash('sha256').update(row.upstreamId).digest('hex').slice(0, 16),
      upstreamModelId: row.upstreamModelId,
      conversationKind: row.conversationKind,
      promptTemplateVersion: row.promptTemplateVersion,
      ...summarizeCacheUsage(group),
    };
  });
}
