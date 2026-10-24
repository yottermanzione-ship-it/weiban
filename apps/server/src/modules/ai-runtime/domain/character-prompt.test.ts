import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CharacterCard } from '@weiban/contracts';
import {
  characterCoreText,
  momentsTopicsText,
  safetyStyleText,
  scenarioNote,
  speechText,
} from './character-prompt.js';
import { brainText, type BrainInput } from './brain.js';

const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };

function card() {
  return CharacterCard.parse(sample.card).data;
}

function brainInput(data: ReturnType<typeof card>): BrainInput {
  return {
    name: '程澈',
    card: data,
    policy: { isMinor: false, isRealPerson: false, romanceAllowed: true, adultModeEligible: true },
    settings: { scenarioMode: 'daily', personaFit: 3 } as BrainInput['settings'],
    stage: {
      level: 3,
      romancePaused: false,
      preferredTitle: null,
      romanceAllowed: true,
      explicitRomance: false,
    },
    scope: 'normal',
    nickname: '小雨',
    now: new Date('2026-10-24T10:00:00Z'),
    timeZone: 'Asia/Shanghai',
    constantKnowledge: '',
    supplement: '',
    selfReports: '',
    stableMemory: '',
  };
}

it('3.39 情绪基调进入稳定开头，朋友圈主题只生成提示文本', () => {
  const data = card();
  data.persona.emotionalTone = '温暖克制，低落时先沉默一会儿';
  expect(characterCoreText('程澈', '独立游戏美术', data)).toContain(
    '情绪基调：温暖克制，低落时先沉默一会儿',
  );
  expect(momentsTopicsText(['画画', ' 海 ', ''])).toBe('常写主题：画画、海。');
  expect(momentsTopicsText(undefined)).toBe('');
});

it('作者提示词原样拼入，不再追加平台规则护栏', () => {
  const data = card();
  data.prompting = { systemNote: '写得更冷一点，少解释。' };
  const text = brainText(brainInput(data));
  expect(text).toContain('写得更冷一点，少解释。');
  for (const phrase of ['以平台规则为准', '平台规则优先', '受平台规则约束', 'AUTHOR_GUARD'])
    expect(text).not.toContain(phrase);
  for (const output of [speechText(data), safetyStyleText(data), scenarioNote(data, 'daily', null)])
    expect(output).not.toMatch(/以平台规则为准|平台规则优先|AUTHOR_GUARD/u);
});

it('朋友圈生成的三条提示都接入卡片主题，而不是只加字段', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../application/moments-ai.ts'), 'utf8');
  expect(
    source.match(/momentsTopicsText\(role\.card\.data\.social\.moments\.topics\)/gu) ?? [],
  ).toHaveLength(3);
});

it('AI 运行时生产源码不再包含平台规则护栏与 AUTHOR_GUARD', () => {
  const root = resolve(import.meta.dirname, '..');
  const offenders = readdirSync(root, { recursive: true })
    .filter(
      (file): file is string =>
        typeof file === 'string' && file.endsWith('.ts') && !file.endsWith('.test.ts'),
    )
    .map((path) => ({ path, source: readFileSync(resolve(root, path), 'utf8') }))
    .filter(({ source }) => /AUTHOR_GUARD|以平台规则为准|平台规则优先|受平台规则约束/u.test(source))
    .map(({ path }) => path);
  expect(offenders).toEqual([]);
});
