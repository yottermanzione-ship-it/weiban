/** Verified TypeSafe System One / B.AI Decisions protocol. No inferred /judge route. */
import { z } from 'zod';
import type {
  DecideAdapterAnswer,
  DecideAdapterQuestion,
  MediaAdapterResult,
  MediaTarget,
} from './media-adapter.js';

const Probability = z.number().min(0).max(1);
const Usage = z.object({
  input_tokens: z.number().int().min(0).max(2147483647),
  output_tokens: z.number().int().min(0).max(2147483647),
});
const Reply = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  usage: Usage,
});
const Choice = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: Probability,
  probabilities: z.record(z.string(), Probability),
});
const Noul = z.object({ type: z.literal('noul'), noul: Probability });
const Score = z.object({
  type: z.literal('score'),
  score: z.number().min(0),
  confidence: Probability,
  probabilities: z.record(z.string(), Probability),
});

export function decisionUrl(target: Pick<MediaTarget, 'kind' | 'baseUrl'>): string | null {
  const base = target.baseUrl.replace(/\/+$/u, '');
  // openai_compatible is the existing shared relay account; only decide() uses this path.
  if (target.kind === 'openai_compatible') return `${base}/decisions`;
  if (target.kind === 'jev') return `${base.replace(/\/v1$/u, '')}/v1/systemone`;
  return null;
}

export function decisionQuestions(questions: readonly DecideAdapterQuestion[]) {
  if (!questions.length || questions.length > 20) return null;
  const entries: [string, unknown][] = [];
  for (const q of questions) {
    if (!q.questionId.trim() || entries.some(([id]) => id === q.questionId) || !q.prompt.trim())
      return null;
    if (q.kind === 'yes_no') entries.push([q.questionId, { type: 'noul', instructions: q.prompt }]);
    else if (q.kind === 'choice') {
      if (
        !q.options.length ||
        q.options.length > 255 ||
        q.options.some((x) => !x.trim()) ||
        new Set(q.options).size !== q.options.length
      )
        return null;
      entries.push([
        q.questionId,
        {
          type: 'choice',
          instructions: q.prompt,
          criteria: Object.fromEntries(q.options.map((x) => [x, null])),
        },
      ]);
    } else if (q.kind === 'scale' && q.options.length >= 2 && q.options.length <= 10) {
      entries.push([q.questionId, { type: 'score', instructions: q.prompt, criteria: q.options }]);
    } else return null;
  }
  return Object.fromEntries(entries);
}

function distribution(probs: Record<string, number>, keys: string[]): boolean {
  return (
    Object.keys(probs).length === keys.length &&
    keys.every((x) => Object.hasOwn(probs, x)) &&
    Math.abs(keys.reduce((sum, x) => sum + probs[x]!, 0) - 1) <= 0.0001
  );
}

export function parseDecisionReply(raw: unknown, questions: readonly DecideAdapterQuestion[]) {
  const parsed = Reply.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data.answers).length !== questions.length) return null;
  const answers: DecideAdapterAnswer[] = [];
  for (const q of questions) {
    const rawAnswer = parsed.data.answers[q.questionId];
    if (q.kind === 'yes_no') {
      const a = Noul.safeParse(rawAnswer);
      if (!a.success) return null;
      const p = a.data.noul;
      answers.push({
        questionId: q.questionId,
        choice: p >= 0.5 ? 'yes' : 'no',
        probabilities: { yes: p, no: 1 - p },
        confidence: Math.abs(2 * p - 1),
      });
    } else {
      const a = q.kind === 'scale' ? Score.safeParse(rawAnswer) : Choice.safeParse(rawAnswer);
      if (!a.success) return null;
      const keys = q.kind === 'scale' ? q.options.map((_, i) => String(i)) : q.options;
      if (!distribution(a.data.probabilities, keys)) return null;
      let choice: string;
      if (a.data.type === 'score') {
        if (a.data.score > q.options.length - 1) return null;
        // Legacy port returns a discrete choice: keep the modal level, not a rounded weighted score.
        choice = keys.reduce(
          (best, key) => (a.data.probabilities[key]! > a.data.probabilities[best]! ? key : best),
          keys[0]!,
        );
      } else {
        choice = a.data.choice;
        if (!keys.includes(choice)) return null;
      }
      answers.push({
        questionId: q.questionId,
        choice,
        probabilities: a.data.probabilities,
        confidence: a.data.confidence,
      });
    }
  }
  return {
    answers,
    inputTokens: parsed.data.usage.input_tokens,
    outputTokens: parsed.data.usage.output_tokens,
    resolvedModel: parsed.data.model,
  };
}

/** Single attempt: a timeout has no supplier idempotency guarantee, so never blindly retry. */
export async function jevDecide(
  target: MediaTarget,
  input: { state: Record<string, unknown>; questions: DecideAdapterQuestion[]; timeoutMs?: number },
): Promise<
  MediaAdapterResult<{
    answers: DecideAdapterAnswer[];
    inputTokens: number;
    outputTokens: number;
    resolvedModel: string;
  }>
> {
  const endpoint = decisionUrl(target);
  const questions = decisionQuestions(input.questions);
  if (!endpoint || !questions) return { ok: false, category: 'bad_request', zeroCost: true };
  const body = JSON.stringify({ model: target.model, state: input.state, questions });
  if (Buffer.byteLength(body, 'utf8') > 32000)
    return { ok: false, category: 'bad_request', zeroCost: true };
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, Math.min(10000, input.timeoutMs ?? 10000))),
      headers: { Authorization: `Bearer ${target.apiKey}`, 'Content-Type': 'application/json' },
      body,
    });
    const reader = response.body?.getReader();
    if (!reader && response.status === 200) return { ok: false, category: 'provider_error' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (reader) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2000000) {
          await reader.cancel();
          return { ok: false, category: 'provider_error' };
        }
        chunks.push(part.value);
      }
    } finally {
      reader?.releaseLock();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      raw = null;
    }
    if (response.status !== 200) {
      const error = z.object({ error: z.object({ code: z.string().optional() }) }).safeParse(raw);
      const code = error.success ? error.data.error.code : '';
      const quota = [
        'insufficient_user_quota',
        'insufficient_team_balance',
        'team_quota_limit_reached',
      ].includes(code ?? '');
      return {
        ok: false,
        ...(response.status < 500 && response.status !== 408 ? { zeroCost: true } : {}),
        category:
          quota || response.status === 402
            ? 'quota_exhausted'
            : response.status === 401 || response.status === 403
              ? 'invalid_key'
              : response.status === 429
                ? 'rate_limited'
                : response.status >= 500
                  ? 'provider_error'
                  : 'bad_request',
      };
    }
    const value = parseDecisionReply(raw, input.questions);
    return value ? { ok: true, value } : { ok: false, category: 'provider_error' };
  } catch {
    return { ok: false, category: 'network_error' };
  }
}
