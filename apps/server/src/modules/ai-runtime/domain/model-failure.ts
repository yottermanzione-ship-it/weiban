/** Only stable gateway reason codes may enter task history. Provider messages can contain input text. */
const MODEL_CAUSES = new Set([
  'interrupted',
  'timeout_deadline',
  'account_rate_limited',
  'account_concurrency_limited',
  'upstream_cooldown',
  'concurrency_limited',
  'account_limited',
  'request_too_large',
  'no_route',
  'no_matching_route_bounds',
  'route_unavailable_or_busy',
  'insufficient_fallback_time',
  'rate_limited',
  'quota_exhausted',
  'invalid_key',
]);

export function modelFailureReason(result: { error: string; message?: string }): string {
  return result.message && MODEL_CAUSES.has(result.message) ? result.message : result.error;
}
