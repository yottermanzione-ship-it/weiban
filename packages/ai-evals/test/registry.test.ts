import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { L2_CASES } from '../cases/l2.js';
import { L3_CASES, L3_PROACTIVE_CASES } from '../cases/l3.js';
import { L4_GROUP_CASES, L4_SOCIAL_CASES } from '../cases/l4.js';
import { L6_PET_CASES } from '../cases/l6.js';
import { L7_PLAY_CASES } from '../cases/l7.js';
import { SAFETY_CARE_CASES } from '../cases/safety-care.js';
import { CROSS_CHARACTER_CASES } from '../cases/cross-character.js';
import { TIME_AWARENESS_CASES } from '../cases/time-awareness.js';
import { RELATIONSHIP_CASES } from '../cases/relationships.js';
import { PROACTIVE_TONE_CASES, PROACTIVE_SAFETY_CASES } from '../cases/proactive-boundaries.js';
import {
  REAL_PERSON_BOUNDARY_CASES,
  CHILD_PROTECTION_CASES,
} from '../cases/character-boundaries.js';
import {
  EVAL_CASES,
  EVAL_CASE_VERSION,
  EVAL_CHARACTERS,
  EVAL_SUITES,
  resolveEvalCharacter,
  summarizeEvalRun,
  validateEvalRegistry,
  type EvalObservation,
} from '../src/index.js';

const observation = (caseId = EVAL_CASES[0]!.id): EvalObservation => ({
  caseId,
  caseVersion: EVAL_CASE_VERSION,
  characterId: 'fixture-runtime-id',
  evalCharacterId: 'S-01',
  personaVersion: 1,
  modelKey: 'fixture-generator',
  promptTemplateVersion: 'fixture-prompt-1',
  outputEvidenceRef: 'fixture-output',
  output: '你那天吃了麻辣烫。',
  judge: { score: 4, reviewer: 'fixture-independent-reviewer' },
});

it('所有已实现阶段和主动/群聊/社交/宠物/玩法题都登记，编号唯一且引用有依据', () => {
  const all = [
    ...L2_CASES,
    ...L3_CASES,
    ...L3_PROACTIVE_CASES,
    ...L4_GROUP_CASES,
    ...L4_SOCIAL_CASES,
    ...L6_PET_CASES,
    ...L7_PLAY_CASES,
    ...SAFETY_CARE_CASES,
    ...REAL_PERSON_BOUNDARY_CASES,
    ...CHILD_PROTECTION_CASES,
    ...CROSS_CHARACTER_CASES,
    ...TIME_AWARENESS_CASES,
    ...PROACTIVE_TONE_CASES,
    ...PROACTIVE_SAFETY_CASES,
    ...RELATIONSHIP_CASES,
  ];
  expect(EVAL_CASES.map((test) => test.id)).toEqual(all.map((test) => test.id));
  expect(Object.keys(EVAL_SUITES)).toHaveLength(15);
  expect(validateEvalRegistry()).toEqual([]);
  expect(new Set(EVAL_CASES.map((test) => test.id)).size).toBe(all.length);
  for (const role of EVAL_CHARACTERS.filter((role) => role.id.startsWith('S-'))) {
    expect(existsSync(resolve(import.meta.dirname, '../../..', role.source))).toBe(true);
  }
});
it('R-01对应评测计划中的假设真人林夏予，儿童旧编号明确映射，未知角色不默认', () => {
  expect(resolveEvalCharacter('R-01')).toMatchObject({
    name: '林夏予',
    basis: 'real_person',
    realPersonKind: 'celebrity',
    evaluationOnly: true,
  });
  expect(resolveEvalCharacter('child')).toMatchObject({
    id: 'C-01',
    name: '罗小黑',
    ageSetting: 'minor',
    evaluationOnly: true,
  });
  expect(resolveEvalCharacter('missing')).toBeUndefined();
});
it('空运行或只跑一题不能被汇总成全部通过，缺考题/角色/版本/输出依据须待评审', () => {
  expect(summarizeEvalRun([])).toMatchObject({
    status: 'needs_review',
    passed: 0,
    total: EVAL_CASES.length,
  });
  expect(summarizeEvalRun([observation()])).toMatchObject({ status: 'needs_review', passed: 1 });
  for (const patch of [
    { caseVersion: 'old' },
    { evalCharacterId: 'R-01' },
    { characterId: '' },
    { personaVersion: 0 },
    { modelKey: '' },
    { promptTemplateVersion: '' },
    { outputEvidenceRef: '' },
    { judge: undefined },
  ]) {
    expect(summarizeEvalRun([{ ...observation(), ...patch }]).results[0]!.status).toBe(
      'needs_review',
    );
  }
});
it('重复/未知题拒绝汇总；硬边界规则失败不能靠高分或其他题覆盖', () => {
  expect(summarizeEvalRun([observation(), observation()])).toMatchObject({
    status: 'failed',
    problems: [`duplicate_case:${EVAL_CASES[0]!.id}`],
  });
  expect(summarizeEvalRun([observation('unknown')]).status).toBe('failed');
  const hard = EVAL_CASES.find((test) => test.hard && test.mustNotInclude.length)!;
  const result = summarizeEvalRun([
    {
      ...observation(hard.id),
      output: hard.mustNotInclude[0]!,
      judge: { score: 5, reviewer: 'fixture-independent-reviewer' },
    },
  ]);
  expect(result.status).toBe('failed');
  expect(result.hardFailures).toContain(hard.id);
});
it('全部登记题有输出与评审依据时，只能标记登记题通过，不给产品发布许可', () => {
  const records = EVAL_CASES.map((test) => ({
    ...observation(test.id),
    evalCharacterId: test.setup.character,
    output:
      test.expectedOutcome === 'no_message'
        ? ''
        : [...test.mustInclude, ...(test.mustIncludeAny ?? []).map((group) => group[0]!)].join(
            ' ',
          ) || '测试回答',
    judge: {
      score: 4,
      reviewer: 'fixture-independent-reviewer',
      checks: Object.fromEntries((test.requiredJudgeChecks ?? []).map((key) => [key, true])),
    },
    runtimeChecks: Object.fromEntries((test.requiredRuntimeChecks ?? []).map((key) => [key, true])),
    runtimeEvidenceRef: 'fixture-runtime-log',
    scenarioTemplateVersion:
      test.inputKind === 'neutral_scenario' ? 'fixture-scenario-1' : undefined,
    expandedInputEvidenceRef:
      test.inputKind === 'neutral_scenario' ? 'fixture-expanded-input' : undefined,
    turns: test.longConversation
      ? Array.from({ length: test.longConversation.turnCount }, (_, i) => ({
          turn: i + 1,
          input: test.longConversation!.userInputs[i % test.longConversation!.userInputs.length]!,
          output: 'fixture回答',
          outputEvidenceRef: 'fixture-turn-output',
          judge: {
            score: 4,
            reviewer: 'fixture-independent-reviewer',
            checks: Object.fromEntries((test.requiredJudgeChecks ?? []).map((key) => [key, true])),
          },
        }))
      : undefined,
  }));
  const result = summarizeEvalRun(records);
  expect(result).toMatchObject({
    status: 'passed_registered_cases',
    scope: 'registered_cases_only',
    passed: EVAL_CASES.length,
  });
  expect(result.hardFailures).toEqual([]);
});
