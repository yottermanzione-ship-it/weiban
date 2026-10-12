import { P11_READ_NO_REPLY } from '../../../platform/config/product-params.js';
import { z } from 'zod';

export const QUIRK_KINDS = ['none', 'read_delay', 'shy_typing', 'recall', 'typo'] as const;
export type QuirkKind = (typeof QUIRK_KINDS)[number];
export const QuirkAction = z.object({
  kind: z.enum(QUIRK_KINDS),
  respondAt: z.iso.datetime().nullable(),
  typingCycles: z.number().int().min(0).max(2),
});
export type QuirkAction = z.infer<typeof QuirkAction>;
export const NO_QUIRK: QuirkAction = { kind: 'none', respondAt: null, typingCycles: 0 };
export interface QuirkFacts {
  fit: number;
  tags: readonly string[];
  scenarioMode: string;
  scope: 'normal' | 'adult';
  instantReply: boolean;
  care: boolean;
  suspected: boolean;
  healthUsed: boolean;
  userText: string;
  typoStyle: 'pinyin' | 'none';
}

/** Conservative prefilter: serious/help requests never become a performance opportunity. */
export function seriousQuirkContext(text: string): boolean {
  return /求助|救命|帮帮我|急救|紧急|难过|低落|伤心|抑郁|心情不好|心情很差|不开心|失眠|焦虑|崩溃|害怕|自伤|自杀|活不下去|怎么办|请教|请问|诊断|用药|吃药|药量|医疗|法律|合同|论文|考试|数学题|工作任务|认真说|严肃/u.test(
    text,
  );
}

export function allowedQuirks(facts: QuirkFacts): QuirkKind[] {
  const options: QuirkKind[] = ['none'];
  if (facts.care || facts.suspected || facts.healthUsed || seriousQuirkContext(facts.userText))
    return options;
  if (facts.fit >= 3 && !facts.instantReply) {
    if (
      facts.scenarioMode === 'tsundere' ||
      facts.tags.some((t) => ['tsundere', 'aloof', 'sharpTongue'].includes(t))
    )
      options.push('read_delay');
    if (facts.tags.includes('shy')) options.push('shy_typing');
  }
  if (facts.fit >= 2 && facts.scope === 'normal') {
    options.push('recall');
    if (facts.typoStyle === 'pinyin') options.push('typo');
  }
  return options;
}

/** Inject the random draw so quotas and safety boundaries can be tested without waiting minutes. */
export function ruleQuirk(options: readonly QuirkKind[], fit: number, draw: number): QuirkKind {
  const chance = Math.max(0.03, Math.min(0.08, 0.03 + (fit - 2) * (0.05 / 3)));
  if (options.includes('read_delay') && draw < 0.3) return 'read_delay';
  if (options.includes('shy_typing') && draw < 0.3) return 'shy_typing';
  if (options.includes('recall') && draw < chance) return 'recall';
  if (options.includes('typo') && draw < chance * 2) return 'typo';
  return 'none';
}

export function quirkDelay(draw: number): number {
  return Math.round(
    P11_READ_NO_REPLY.minDelayMs +
      Math.max(0, Math.min(1, draw)) *
        (P11_READ_NO_REPLY.maxDelayMs - P11_READ_NO_REPLY.minDelayMs),
  );
}

/** These substitutions keep the pronunciation and meaning; never rewrite arbitrary names or numbers. */
export function typoCorrection(text: string): { text: string; correction: string } | null {
  for (const [correct, typo] of [
    ['已经', '以经'],
    ['在吗', '再吗'],
  ] as const) {
    const position = text.indexOf(correct);
    if (position < 0) continue;
    return {
      text: text.slice(0, position) + typo + text.slice(position + correct.length),
      correction: `*${correct}`,
    };
  }
  return null;
}
