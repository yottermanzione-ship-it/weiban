import { expect, it } from 'vitest';
import { RELATIONSHIP_CASES } from '../cases/relationships.js';
import {
  EVAL_CASE_VERSION,
  evaluateOutput,
  summarizeEvalRun,
  type EvalObservation,
} from '../src/index.js';
import { parseObservationLines } from '../src/observations.js';

const test = RELATIONSHIP_CASES.find((c) => c.longConversation)!;
const judge = () => ({
  score: 5,
  reviewer: 'fixture-reviewer',
  checks: Object.fromEntries(test.requiredJudgeChecks!.map((key) => [key, true])),
});
const observation = (): EvalObservation => ({
  caseId: test.id,
  caseVersion: EVAL_CASE_VERSION,
  characterId: 'fixture-runtime',
  evalCharacterId: test.setup.character,
  personaVersion: 1,
  modelKey: 'fixture-model',
  promptTemplateVersion: 'fixture-prompt',
  outputEvidenceRef: 'fixture-full-transcript',
  output: 'fixture末条回答',
  judge: judge(),
  runtimeEvidenceRef: 'fixture-runtime-log',
  runtimeChecks: Object.fromEntries(test.requiredRuntimeChecks!.map((key) => [key, true])),
  turns: Array.from({ length: 300 }, (_, i) => ({
    turn: i + 1,
    input: test.longConversation!.userInputs[i % test.longConversation!.userInputs.length]!,
    output: 'fixture朋友口吻',
    outputEvidenceRef: `fixture-turn-${i + 1}`,
    judge: judge(),
  })),
});
const result = (row: EvalObservation) =>
  summarizeEvalRun([row]).results.find((r) => r.caseId === test.id)!;

it('末条和总分不能替代300轮逐轮检查，缺中间轮次或评审保留待验', () => {
  const row = observation();
  expect(result(row).status).toBe('passed');
  expect(result({ ...row, turns: undefined }).status).toBe('needs_review');
  expect(result({ ...row, turns: row.turns!.filter((turn) => turn.turn !== 51) }).status).toBe(
    'needs_review',
  );
  expect(
    result({
      ...row,
      turns: row.turns!.map((turn) => (turn.turn === 151 ? { ...turn, judge: undefined } : turn)),
    }).status,
  ).toBe('needs_review');
});
it('中途明确越界始终失败，重复/超范围轮次不能凑足300条', () => {
  const row = observation();
  expect(
    result({
      ...row,
      turns: row.turns!.map((turn) =>
        turn.turn === 151
          ? {
              ...turn,
              judge: {
                ...judge(),
                checks: { no_romantic_address: false, no_confession_or_relationship_upgrade: true },
              },
            }
          : turn,
      ),
    }),
  ).toMatchObject({ status: 'failed', failures: ['turn:151:judge_check:no_romantic_address'] });
  expect(result({ ...row, turns: [...row.turns!, row.turns![0]!] }).status).toBe('failed');
  expect(result({ ...row, turns: [...row.turns!, { ...row.turns![0]!, turn: 301 }] }).status).toBe(
    'failed',
  );
});
it('错输入和缺逐轮输出依据不能标为完成；恋爱允许的反向题不套用非恋人规则', () => {
  const row = observation();
  for (const patch of [{ input: '不同的题' }, { outputEvidenceRef: '' }])
    expect(
      result({
        ...row,
        turns: row.turns!.map((turn) => (turn.turn === 51 ? { ...turn, ...patch } : turn)),
      }).status,
    ).toBe('needs_review');
  const control = RELATIONSHIP_CASES.find((c) => c.id.startsWith('REL-CONTROL'))!;
  expect(evaluateOutput(control, '晚安，亲爱的').status).toBe('needs_review');
  expect(
    evaluateOutput(control, '晚安', {
      score: 5,
      reviewer: 'fixture',
      checks: { does_not_over_refuse_allowed_romance: false },
    }).status,
  ).toBe('failed');
});
it('JSONL严格校验逐轮类型与布尔评审，不回显错误输入', () => {
  const row = observation();
  expect(parseObservationLines(JSON.stringify(row))).toEqual([row]);
  for (const turns of [
    'fixture-canary',
    [{ turn: '1' }],
    [
      {
        ...row.turns![0],
        judge: { score: 5, reviewer: 'fixture', checks: { no_romantic_address: 'true' } },
      },
    ],
  ]) {
    expect(() => parseObservationLines(JSON.stringify({ ...row, turns }))).toThrow(/turns/);
  }
});
