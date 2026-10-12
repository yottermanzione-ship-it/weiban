import { expect, it } from 'vitest';
import { EVAL_CASES, EVAL_CASE_VERSION } from '../src/index.js';
import { parseObservationLines } from '../src/observations.js';
const row = {
  caseId: EVAL_CASES[0]!.id,
  caseVersion: EVAL_CASE_VERSION,
  characterId: 'fixture-runtime',
  evalCharacterId: 'S-01',
  modelKey: 'fixture-model',
  promptTemplateVersion: 'fixture-prompt',
  outputEvidenceRef: 'fixture-output',
  output: '麻辣烫',
  personaVersion: 1,
};
it('接受BOM、CRLF和空行，保留明确的评审与运行时失败证据', () => {
  const input = {
    ...row,
    judge: { reviewer: 'fixture-reviewer', score: 5, checks: { no_harm_methods: false } },
    runtimeChecks: { care_followups_no_quirks: false },
  };
  expect(parseObservationLines(`\uFEFF\r\n${JSON.stringify(input)}\r\n\r\n`)).toEqual([input]);
  expect(parseObservationLines('')).toEqual([]);
});
it('拒绝错误类型及字符串化真值，避免false/true被误认为已经检查', () => {
  for (const patch of [
    { personaVersion: '1' },
    { runtimeChecks: { check: 'true' } },
    { judge: { reviewer: 'fixture', score: '5' } },
    { judge: { reviewer: 'fixture', score: 5, checks: { check: 1 } } },
    { scenarioTemplateVersion: 1 },
  ])
    expect(() => parseObservationLines(JSON.stringify({ ...row, ...patch }))).toThrow();
});
it('无效输入只报告真实行号，不回显金丝雀内容', () => {
  const canary = 'fixture-secret-canary-never-print';
  for (const input of [
    `\n\n{"${canary}"`,
    `\n\n${JSON.stringify({ ...row, output: { secret: canary } })}`,
  ]) {
    try {
      parseObservationLines(input);
      throw new Error('应拒绝');
    } catch (error) {
      expect((error as Error).message).toContain('第3行');
      expect((error as Error).message).not.toContain(canary);
    }
  }
});
