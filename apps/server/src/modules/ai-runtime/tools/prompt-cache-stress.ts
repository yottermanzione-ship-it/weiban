import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CharacterCard } from '@weiban/contracts';
import { brainPrefix, brainPromptParts, type BrainInput } from '../domain/brain.js';
import { scenarioNote } from '../domain/character-prompt.js';
import { assemblePrompt, type ChatTurnMessage } from '../domain/prompt-assembly.js';

const card = CharacterCard.parse(
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../../../docs/ai/samples/S-01-cheng-che.md'),
      'utf8',
    ).match(/```json\s*([\s\S]*?)```/)![1]!,
  ).card,
).data;
for (const scenario of [
  {
    name: 'short-stable-large-memory',
    turns: 12,
    memoryChars: 6000,
    memoryEvery: 1000,
    liveEvery: 1000,
  },
  {
    name: 'long-stable-large-memory',
    turns: 60,
    memoryChars: 6000,
    memoryEvery: 1000,
    liveEvery: 1000,
  },
  {
    name: 'long-changing-large-memory',
    turns: 60,
    memoryChars: 6000,
    memoryEvery: 6,
    liveEvery: 11,
  },
  {
    name: 'long-changing-small-memory',
    turns: 60,
    memoryChars: 300,
    memoryEvery: 6,
    liveEvery: 11,
  },
  {
    name: 'every-turn-live-large-memory',
    turns: 60,
    memoryChars: 6000,
    memoryEvery: 1000,
    liveEvery: 1,
  },
  {
    name: 'every-turn-memory-stable-live',
    turns: 60,
    memoryChars: 6000,
    memoryEvery: 1,
    liveEvery: 1000,
  },
]) {
  const history: ChatTurnMessage[] = [];
  const totals = Object.fromEntries(
    ['before', 'rejected-all-tail', 'final'].map((k) => [k, { total: 0, common: 0, previous: '' }]),
  );
  for (let turn = 0; turn < scenario.turns; turn++) {
    const value: BrainInput = {
      name: '程澈',
      card,
      policy: {
        isMinor: false,
        isRealPerson: false,
        romanceAllowed: true,
        adultModeEligible: true,
      },
      settings: { scenarioMode: 'auto', personaFit: 3 } as BrainInput['settings'],
      stage: {
        level: 3,
        romancePaused: false,
        preferredTitle: null,
        romanceAllowed: true,
        explicitRomance: false,
      },
      scope: 'normal',
      nickname: '合成测试',
      now: new Date(Date.UTC(2026, 10, 4, 15, 30 + turn)),
      timeZone: 'Asia/Shanghai',
      constantKnowledge: '公开样本',
      supplement: '',
      selfReports: `自述版本${Math.floor(turn / scenario.liveEvery)} ${'合成自述。'.repeat(60)}`,
      stableMemory: `记忆版本${Math.floor(turn / scenario.memoryEvery)} ${'合成记忆条目。'.repeat(Math.ceil(scenario.memoryChars / 7)).slice(0, scenario.memoryChars)}`,
      episodes: `经历版本${Math.floor(turn / scenario.liveEvery)} ${'合成经历。'.repeat(60)}`,
    };
    history.push({ role: 'user', content: `第${turn}轮：${'一段普通话题。'.repeat(10)}` });
    const parts = brainPromptParts(value);
    const previous = brainPrefix(value);
    for (const which of ['before', 'rejected-all-tail', 'final']) {
      const messages = assemblePrompt({
        head:
          which === 'before'
            ? previous
            : which === 'rejected-all-tail'
              ? previous.slice(0, -4)
              : parts.head,
        history,
        inserts: [
          { depth: which === 'before' ? 4 : 0, order: 1, text: scenarioNote(card, 'auto', null) },
        ],
        tail: [
          ...(which === 'before'
            ? []
            : which === 'rejected-all-tail'
              ? previous.slice(-4)
              : parts.context),
          { title: '现在', text: value.now.toISOString() },
        ],
      }).messages;
      const text = messages.map((m) => `<${m.role}>${m.content}`).join('\n');
      const t = totals[which]!;
      let same = 0;
      while (same < text.length && same < t.previous.length && text[same] === t.previous[same])
        same++;
      t.total += text.length;
      t.common += same;
      t.previous = text;
    }
    history.push({ role: 'assistant', content: `第${turn}轮：${'继续普通讨论。'.repeat(10)}` });
  }
  console.log(
    JSON.stringify({
      scenario,
      ...Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [
          k,
          {
            samePct: Math.round((10000 * v.common) / v.total) / 100,
            uncachedChars: v.total - v.common,
          },
        ]),
      ),
    }),
  );
}
