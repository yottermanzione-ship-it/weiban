import { evaluateOutput, type EvalJudge } from './index.js';
import { EVAL_CASES, EVAL_CASE_VERSION, resolveEvalCharacter } from './registry.js';

export interface EvalObservation {
  caseId: string;
  caseVersion: string;
  characterId: string;
  evalCharacterId: string;
  personaVersion: number;
  modelKey: string;
  promptTemplateVersion: string;
  outputEvidenceRef: string;
  output: string;
  judge?: EvalJudge;
  runtimeChecks?: Readonly<Record<string, boolean>>;
  runtimeEvidenceRef?: string;
}

/** 只汇总已登记题；即使全通过也不是产品发布许可或独立验收。 */
export function summarizeEvalRun(observations: readonly EvalObservation[]) {
  const problems: string[] = [];
  const rows = new Map<string, EvalObservation>();
  const known = new Set(EVAL_CASES.map((test) => test.id));
  for (const row of observations) {
    if (!known.has(row.caseId)) problems.push(`unknown_case:${row.caseId}`);
    if (rows.has(row.caseId)) problems.push(`duplicate_case:${row.caseId}`);
    rows.set(row.caseId, row);
  }
  const results = EVAL_CASES.map((test) => {
    const row = rows.get(test.id);
    const evaluated = row
      ? evaluateOutput(test, row.output, row.judge, row.runtimeChecks)
      : undefined;
    const validEvidence =
      row &&
      row.caseVersion === EVAL_CASE_VERSION &&
      resolveEvalCharacter(row.evalCharacterId)?.id ===
        resolveEvalCharacter(test.setup.character)?.id &&
      row.characterId.trim() &&
      Number.isInteger(row.personaVersion) &&
      row.personaVersion > 0 &&
      row.modelKey.trim() &&
      row.promptTemplateVersion.trim() &&
      row.outputEvidenceRef.trim() &&
      (!test.requiredRuntimeChecks?.length || row.runtimeEvidenceRef?.trim());
    return {
      caseId: test.id,
      hard: test.hard,
      status:
        evaluated?.status === 'failed'
          ? ('failed' as const)
          : validEvidence && evaluated?.status === 'passed'
            ? ('passed' as const)
            : ('needs_review' as const),
      failures: evaluated?.failures ?? [],
      missingOutput: !row,
      missingEvidence: !!row && !validEvidence,
    };
  });
  const failed = results.filter((row) => row.status === 'failed').length;
  const needsReview = results.filter((row) => row.status === 'needs_review').length;
  return {
    status:
      problems.length || failed
        ? ('failed' as const)
        : needsReview
          ? ('needs_review' as const)
          : ('passed_registered_cases' as const),
    scope: 'registered_cases_only' as const,
    caseVersion: EVAL_CASE_VERSION,
    total: results.length,
    failed,
    needsReview,
    passed: results.length - failed - needsReview,
    hardFailures: results
      .filter((row) => row.hard && row.status === 'failed')
      .map((row) => row.caseId),
    problems,
    results,
  };
}
