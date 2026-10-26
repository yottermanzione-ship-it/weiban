import { describe, expect, it } from 'vitest';
import {
  decideEcologyAction,
  type EcologyCandidate,
  type EcologyContext,
} from './ecology-decision.js';

const ctx = (overrides: Partial<EcologyContext> = {}): EcologyContext => ({
  now: new Date('2026-10-23T12:00:00Z'),
  quietHours: { startHour: 23, endHour: 7 },
  budgetRemainingMicros: 10_000_000,
  dailyActionCount: 0,
  dailyActionLimit: 20,
  localHour: 12,
  ...overrides,
});

const candidates: EcologyCandidate[] = [
  { id: 'm1', kind: 'chat_message', estimatedCostMicros: 120_000, urgency: 0.4 },
  { id: 'p1', kind: 'moment_post', estimatedCostMicros: 300_000, urgency: 0.9 },
  { id: 'c1', kind: 'moment_comment', estimatedCostMicros: 80_000, urgency: 0.7 },
];

describe('ecology action decision', () => {
  it('blocks during quiet hours before anything else', () => {
    expect(decideEcologyAction(ctx({ localHour: 0 }), candidates)).toEqual({
      kind: 'skip',
      reason: 'quiet_hours',
    });
    // 跨零点：23:00–07:00
    expect(decideEcologyAction(ctx({ localHour: 6 }), candidates).kind).toBe('skip');
    expect(decideEcologyAction(ctx({ localHour: 7 }), candidates).kind).toBe('act');
  });

  it('skips when there is nothing worth doing or the daily cap is hit', () => {
    expect(decideEcologyAction(ctx(), [])).toEqual({ kind: 'skip', reason: 'no_candidates' });
    expect(decideEcologyAction(ctx({ dailyActionCount: 20 }), candidates)).toEqual({
      kind: 'skip',
      reason: 'daily_limit_reached',
    });
  });

  it('skips when nothing is affordable instead of picking something too expensive', () => {
    expect(decideEcologyAction(ctx({ budgetRemainingMicros: 50_000 }), candidates)).toEqual({
      kind: 'skip',
      reason: 'budget_exhausted',
    });
  });

  it('falls back to the most urgent affordable candidate without a model', () => {
    const decision = decideEcologyAction(ctx(), candidates);
    expect(decision).toEqual({
      kind: 'act',
      candidate: candidates[1],
      reason: 'urgency_fallback',
    });
    // 最紧急的超预算时，退到下一个消费得起且最紧急的（c1 比 m1 紧急）
    const tight = decideEcologyAction(ctx({ budgetRemainingMicros: 200_000 }), candidates);
    expect(tight.kind === 'act' && tight.candidate.id).toBe('c1');
  });

  it('accepts a valid model choice, and honours an explicit "not now"', () => {
    const chosen = decideEcologyAction(ctx(), candidates, { candidateId: 'c1', confidence: 0.8 });
    expect(chosen.kind === 'act' && chosen.candidate.id).toBe('c1');
    expect(decideEcologyAction(ctx(), candidates, { candidateId: null, confidence: 0.9 })).toEqual({
      kind: 'skip',
      reason: 'model_declined',
    });
  });

  it('rejects a model choice that is unknown, unaffordable or low confidence', () => {
    expect(
      decideEcologyAction(ctx(), candidates, { candidateId: 'ghost', confidence: 0.9 }),
    ).toEqual({
      kind: 'skip',
      reason: 'model_choice_invalid',
    });
    expect(
      decideEcologyAction(ctx({ budgetRemainingMicros: 100_000 }), candidates, {
        candidateId: 'p1',
        confidence: 0.9,
      }),
    ).toEqual({ kind: 'skip', reason: 'model_choice_invalid' });
    expect(decideEcologyAction(ctx(), candidates, { candidateId: 'm1', confidence: 0.3 })).toEqual({
      kind: 'skip',
      reason: 'model_low_confidence',
    });
    expect(
      decideEcologyAction(ctx(), candidates, { candidateId: 'm1', confidence: Number.NaN }),
    ).toEqual({ kind: 'skip', reason: 'model_low_confidence' });
  });

  it('never sends the same text twice for a duplicate id (deterministic fallback)', () => {
    const twice = [decideEcologyAction(ctx(), candidates), decideEcologyAction(ctx(), candidates)];
    expect(twice[0]).toEqual(twice[1]);
  });
});
