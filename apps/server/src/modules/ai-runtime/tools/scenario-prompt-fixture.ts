/** Public sample card + fixed fictional context; never connects to the database. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { CharacterCard, type ScenarioMode } from '@weiban/contracts';
import { brainPrefix, brainText, type BrainInput } from '../domain/brain.js';
import { scenarioNote } from '../domain/character-prompt.js';

export function scenarioFixture(mode: ScenarioMode = 'daily', level = 1): BrainInput {
  const sample = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  );
  return {
    name: '程澈',
    card: CharacterCard.parse(sample.card).data,
    policy: { isMinor: false, isRealPerson: false, romanceAllowed: true, adultModeEligible: true },
    settings: { scenarioMode: mode, personaFit: 3 } as BrainInput['settings'],
    stage: {
      level,
      romancePaused: false,
      preferredTitle: null,
      romanceAllowed: true,
      explicitRomance: mode === 'adult',
    },
    scope: mode === 'adult' ? 'adult' : 'normal',
    nickname: '小雨',
    now: new Date('2026-11-10T12:00:00Z'),
    timeZone: 'Asia/Shanghai',
    constantKnowledge: '固定公开资料：虚构作品灯塔',
    supplement: '固定补充：喜欢猫',
    selfReports: '固定自述：在海边长大',
    stableMemory: '固定记忆：周六一起聊画画',
    scenarioPrompt: `固定测试预设：${mode}。保留角色身份与既有事实。`,
  };
}
export const fixtureDigest = (text: string) => createHash('sha256').update(text).digest('hex');
if (process.argv.includes('--baseline')) {
  const values = Object.fromEntries(
    (['daily', 'auto', 'treehole', 'cheer', 'tsundere', 'romance'] as const).map((mode) => {
      const value = scenarioFixture(mode);
      return [
        mode,
        {
          brain: fixtureDigest(brainText(value)),
          note: fixtureDigest(
            scenarioNote(value.card!, mode, mode === 'auto' ? '固定自动风格' : null, true),
          ),
        },
      ];
    }),
  );
  console.log(JSON.stringify(values, null, 2));
}
if (process.argv.includes('--print'))
  console.log(brainText(scenarioFixture('adult')).split('\n').slice(0, 30).join('\n'));
if (process.argv.includes('--relationship'))
  console.log(brainPrefix(scenarioFixture('adult')).find((s) => s.title === '关系与设置')?.text);
