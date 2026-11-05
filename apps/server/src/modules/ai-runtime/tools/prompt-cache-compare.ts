/** T-20261105b: synthetic exact-prefix comparison only; no provider, database or real user data. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CharacterCard } from '@weiban/contracts';
import { brainPrefix, brainPromptParts, type BrainInput } from '../domain/brain.js';
import { AUTHOR_NOTE_DEPTH, scenarioNote } from '../domain/character-prompt.js';
import { assemblePrompt, type ChatTurnMessage } from '../domain/prompt-assembly.js';

const card = CharacterCard.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  ).card,
).data;
const history: ChatTurnMessage[] = [];
const totals = {
  before: { total: 0, common: 0, previous: '' },
  after: { total: 0, common: 0, previous: '' },
};
for (let turn = 0; turn < 60; turn++) {
  const value: BrainInput = {
    name: '程澈',
    card,
    policy: { isMinor: false, isRealPerson: false, romanceAllowed: true, adultModeEligible: true },
    settings: { scenarioMode: 'auto', personaFit: 3 } as BrainInput['settings'],
    stage: {
      level: 3,
      romancePaused: false,
      preferredTitle: null,
      romanceAllowed: true,
      explicitRomance: false,
    },
    scope: 'normal',
    nickname: '合成测试用户',
    now: new Date(Date.UTC(2026, 10, 4, 15, 30 + turn)),
    timeZone: 'Asia/Shanghai',
    constantKnowledge: '这是公开样本角色。',
    supplement: '',
    selfReports: `合成自述版本 ${Math.floor(turn / 11)}`,
    stableMemory: `合成常驻记忆版本 ${Math.floor(turn / 6)}`,
    episodes: `合成共同经历版本 ${Math.floor(turn / 13)}`,
  };
  history.push({
    role: 'user',
    content: `第 ${turn + 1} 轮合成问题。${'讨论一段普通话题。'.repeat(5)}`,
  });
  const parts = brainPromptParts(value);
  for (const which of ['before', 'after'] as const) {
    const messages = assemblePrompt({
      macros: { user: '合成测试用户', char: '程澈' },
      head: which === 'before' ? brainPrefix(value) : parts.head,
      history,
      inserts: [
        {
          depth: which === 'before' ? 4 : AUTHOR_NOTE_DEPTH,
          order: 1,
          text: scenarioNote(card, 'auto', turn % 3 ? '本轮轻松交流。' : '本轮认真倾听。'),
        },
      ],
      tail: [
        ...(which === 'after' ? parts.context : []),
        { title: '现在', text: value.now.toISOString() },
      ],
    }).messages;
    const text = messages.map((m) => `<${m.role}>${m.content}`).join('\n');
    const tally = totals[which];
    let same = 0;
    while (
      same < text.length &&
      same < tally.previous.length &&
      text[same] === tally.previous[same]
    )
      same++;
    tally.total += text.length;
    tally.common += same;
    tally.previous = text;
  }
  history.push({
    role: 'assistant',
    content: `第 ${turn + 1} 轮合成回答。${'继续这段普通话题。'.repeat(5)}`,
  });
}
console.log(
  JSON.stringify(
    {
      syntheticOnly: true,
      turns: 60,
      meaning: '相邻请求相同前缀字符占比；不是供应商 token 命中率或节省比例',
      ...Object.fromEntries(
        Object.entries(totals).map(([key, v]) => [
          key,
          {
            inputChars: v.total,
            commonPrefixChars: v.common,
            commonPrefixPercent: Math.round((10000 * v.common) / v.total) / 100,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);
