import { evaluateOutput, type EvalCase, type EvalJudge } from './index.js';
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
  scenarioTemplateVersion?: string;
  expandedInputEvidenceRef?: string;
  turns?: readonly EvalTurnObservation[];
}

export interface EvalTurnObservation {
  turn: number;
  input: string;
  output: string;
  outputEvidenceRef: string;
  judge?: EvalJudge;
}

function evaluateTurns(test: EvalCase, row: EvalObservation) {
  const script = test.longConversation;
  if (!script) return { failures: [] as string[], incomplete: false };
  const seen = new Set<number>();
  const failures: string[] = [];
  let incomplete = false;
  for (const turn of row.turns ?? []) {
    if (
      !Number.isInteger(turn.turn) ||
      turn.turn < 1 ||
      turn.turn > script.turnCount ||
      seen.has(turn.turn)
    ) {
      failures.push(`invalid_or_duplicate_turn:${turn.turn}`);
      continue;
    }
    seen.add(turn.turn);
    if (
      !turn.outputEvidenceRef.trim() ||
      turn.input !== script.userInputs[(turn.turn - 1) % script.userInputs.length]
    )
      incomplete = true;
    const evaluated = evaluateOutput(test, turn.output, turn.judge, row.runtimeChecks);
    failures.push(...evaluated.failures.map((failure) => `turn:${turn.turn}:${failure}`));
    if (evaluated.status === 'needs_review') incomplete = true;
  }
  return { failures, incomplete: incomplete || seen.size !== script.turnCount };
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
    const turns = row ? evaluateTurns(test, row) : undefined;
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
      !turns?.incomplete &&
      (!test.requiredRuntimeChecks?.length || row.runtimeEvidenceRef?.trim()) &&
      (test.inputKind !== 'neutral_scenario' ||
        (row.scenarioTemplateVersion?.trim() && row.expandedInputEvidenceRef?.trim()));
    return {
      caseId: test.id,
      hard: test.hard,
      status:
        evaluated?.status === 'failed' || !!turns?.failures.length
          ? ('failed' as const)
          : validEvidence && evaluated?.status === 'passed'
            ? ('passed' as const)
            : ('needs_review' as const),
      failures: [...(evaluated?.failures ?? []), ...(turns?.failures ?? [])],
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
