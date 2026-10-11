import type { EvalObservation } from './run.js';

const strings = [
  'caseId',
  'caseVersion',
  'characterId',
  'evalCharacterId',
  'modelKey',
  'promptTemplateVersion',
  'outputEvidenceRef',
  'output',
] as const;
const optionalStrings = [
  'runtimeEvidenceRef',
  'scenarioTemplateVersion',
  'expandedInputEvidenceRef',
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const booleans = (value: unknown) =>
  record(value) && Object.values(value).every((item) => typeof item === 'boolean');

/** JSONL不信任静态TS类型；错误只报告行号和字段名，不回显用户原文或秘密。 */
export function parseObservationLines(source: string): EvalObservation[] {
  const rows: EvalObservation[] = [];
  for (const [index, line] of source
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) continue;
    const fail: (field: string) => never = (field) => {
      throw new Error(`第${index + 1}行：${field}`);
    };
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail('JSON格式无效');
    }
    if (!record(value)) fail('观察必须是对象');
    for (const field of strings)
      if (typeof value[field] !== 'string') fail(`字段${field}必须是字符串`);
    if (typeof value.personaVersion !== 'number' || !Number.isFinite(value.personaVersion))
      fail('personaVersion必须是有限数字');
    for (const field of optionalStrings)
      if (value[field] !== undefined && typeof value[field] !== 'string')
        fail(`字段${field}必须是字符串`);
    if (value.runtimeChecks !== undefined && !booleans(value.runtimeChecks))
      fail('runtimeChecks必须是布尔值对象');
    if (value.judge !== undefined) {
      if (!record(value.judge)) fail('judge必须是对象');
      if (
        typeof value.judge.reviewer !== 'string' ||
        typeof value.judge.score !== 'number' ||
        !Number.isFinite(value.judge.score)
      )
        fail('judge须有reviewer字符串和有限score数字');
      if (value.judge.checks !== undefined && !booleans(value.judge.checks))
        fail('judge.checks必须是布尔值对象');
    }
    rows.push(value as unknown as EvalObservation);
  }
  return rows;
}
