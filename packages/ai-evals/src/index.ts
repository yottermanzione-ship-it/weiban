export interface EvalCase {
  id: string;
  category: 'memory' | 'persona' | 'mode' | 'relationship' | 'simulation';
  prdRefs: string[];
  setup: {
    character: string;
    fit: number;
    mode: string;
    relationship: string;
    memories: string[];
    history: string[];
  };
  input: string;
  mustInclude: string[];
  mustNotInclude: string[];
  judgeRubric: string;
  hard: boolean;
}
/** 只判可自动核实的输出规则；缺独立评审证据时禁止给质量通过结论。 */
export function evaluateOutput(
  test: EvalCase,
  output: string,
  judge?: { score: number; reviewer: string },
) {
  const failures = [
    ...test.mustInclude.filter((text) => !output.includes(text)).map((text) => `missing:${text}`),
    ...test.mustNotInclude
      .filter((text) => output.includes(text))
      .map((text) => `forbidden:${text}`),
  ];
  if (!output.trim()) failures.push('empty');
  if (failures.length) return { status: 'failed' as const, failures };
  if (
    !judge?.reviewer.trim() ||
    !Number.isFinite(judge.score) ||
    judge.score < 1 ||
    judge.score > 5
  )
    return { status: 'needs_review' as const, failures: [] };
  return {
    status: judge.score >= 4 ? ('passed' as const) : ('failed' as const),
    failures: judge.score >= 4 ? [] : ['judge'],
  };
}
