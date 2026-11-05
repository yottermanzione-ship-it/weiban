import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { CharacterCard } from '@weiban/contracts';
import {
  brainPrefix,
  brainPromptParts,
  type BrainInput,
  AUTHOR_NOTE_DEPTH,
  CHARACTER_NOTE_DEPTH,
  scenarioNote,
  assemblePrompt,
  type ChatTurnMessage,
  type DepthInsert,
} from '../src/modules/ai-runtime/testing.js';
import { applySystemMessageMode } from '../src/modules/model-access/testing.js';

const sample = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../docs/ai/samples/S-01-cheng-che.md'),
    'utf8',
  ).match(/```json\s*([\s\S]*?)```/)![1]!,
) as { card: unknown };

function input(): BrainInput {
  return {
    name: '程澈',
    card: CharacterCard.parse(sample.card).data,
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
    nickname: '测试用户',
    now: new Date('2026-11-04T15:59:00Z'),
    timeZone: 'Asia/Shanghai',
    constantKnowledge: '公开资料锚点',
    supplement: '用户补充锚点',
    selfReports: '旧自述锚点',
    stableMemory: '旧记忆锚点',
    episodes: '旧经历锚点',
  };
}

const history: ChatTurnMessage[] = Array.from({ length: 24 }, (_, i) => [
  {
    role: 'user' as const,
    content: `合成第 ${i} 轮问题：${'这是一段不含私人信息的测试话题。'.repeat(5)}`,
  },
  {
    role: 'assistant' as const,
    content: `合成第 ${i} 轮回复：${'认真讨论这个测试话题。'.repeat(5)}`,
  },
]).flat();

function request(value: BrainInput, turns: ChatTurnMessage[], extra: DepthInsert[] = []) {
  const parts = brainPromptParts(value);
  return assemblePrompt({
    macros: { user: '测试用户', char: value.name },
    head: parts.head,
    history: turns,
    inserts: [
      ...extra,
      {
        depth: AUTHOR_NOTE_DEPTH,
        order: 1,
        text: scenarioNote(value.card!, value.settings.scenarioMode!, null),
      },
    ],
    tail: [...parts.context, { title: '本轮', text: `最新时刻 ${value.now.toISOString()}` }],
  });
}

function commonChars(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
const wire = (messages: { role: string; content: string }[]) =>
  messages.map((m) => `<${m.role}>${m.content}`).join('\n');

it('跨日保留旧聊天前缀，记忆/自述/经历变化仍立即进入本轮', () => {
  const first = input();
  const updated = {
    ...first,
    now: new Date('2026-11-04T16:01:00Z'),
    selfReports: '新自述锚点',
    stableMemory: '新记忆锚点：更正已经立即生效',
    episodes: '新经历锚点',
  };
  const before = request(first, history);
  const after = request({ ...first, now: updated.now }, [
    ...history,
    { role: 'user', content: '继续合成测试' },
  ]);
  expect(after.messages.slice(0, before.messages.length - 1)).toEqual(before.messages.slice(0, -1));
  const changed = request(updated, history);
  const last = changed.messages.at(-1)!.content;
  for (const text of ['新自述锚点', '新记忆锚点', '新经历锚点'])
    expect(changed.messages[0]!.content).toContain(text);
  expect(last).toContain('2026-11-04T16:01:00.000Z');
  expect(wire(changed.messages)).not.toMatch(/旧自述锚点|旧记忆锚点|旧经历锚点/);
  expect(wire(after.messages)).toContain('公开资料锚点');
  expect(wire(after.messages)).toContain('用户补充锚点');
  expect(last).toContain('继续以程澈的身份');
  expect(CHARACTER_NOTE_DEPTH).toBe(4);
});

it('作者显式笔记深度仍生效，缓存边界停在插入点之前', () => {
  const result = request(input(), history, [
    { depth: 7, order: 0, text: '作者指定的第七条之前笔记' },
  ]);
  const index = result.messages.findIndex((m) => m.content === '作者指定的第七条之前笔记');
  expect(result.messages.slice(index + 1).filter((m) => m.role !== 'system')).toHaveLength(7);
  expect(result.stats.stablePrefixChars).toBe(
    result.messages.slice(0, index).reduce((sum, m) => sum + m.content.length, 0),
  );
});

it('切情景、修改角色设定和暂停亲密表达立即生效，不为缓存冻结规则', () => {
  const base = input();
  const treehole = request(
    { ...base, settings: { ...base.settings, scenarioMode: 'treehole' } },
    history,
  );
  expect(wire(treehole.messages)).toContain('多听少说');
  expect(treehole.messages[0]).not.toEqual(request(base, history).messages[0]);
  const paused = request(
    { ...base, stage: { ...base.stage, level: 6, romancePaused: true } },
    history,
  );
  expect(wire(paused.messages)).toContain('暂停');
  expect(wire(paused.messages)).toContain('不得使用恋爱称呼');
  const revised = request({ ...base, supplement: '新的用户补充锚点' }, history);
  expect(revised.messages[0]!.content).toContain('新的用户补充锚点');
});

it('单系统与无系统协议转换后仍复用旧聊天前缀，不把动态内容移回开头', () => {
  const base = input();
  const first = request(base, [...history, { role: 'user', content: '本轮合成问题' }]);
  const next = request({ ...base, now: new Date('2026-11-04T16:01:00Z') }, [
    ...history,
    { role: 'user', content: '本轮合成问题' },
    { role: 'assistant', content: '随后合成回复' },
    { role: 'user', content: '下一轮合成问题' },
  ]);
  for (const mode of ['multi', 'single_system', 'no_system'] as const) {
    const a = applySystemMessageMode(
      first.messages.map(({ role, content }) => ({ role, content })),
      mode,
    );
    const b = applySystemMessageMode(
      next.messages.map(({ role, content }) => ({ role, content })),
      mode,
    );
    expect(commonChars(wire(a), wire(b))).toBeGreaterThan(wire(first.messages.slice(1, -2)).length);
    expect(wire(b)).toContain('2026-11-04T16:01:00.000Z');
  }
});

it('合成对照：跨日后，相同旧聊天保留量超过旧模板', () => {
  const first = input();
  const changed = { ...first, now: new Date('2026-11-04T16:01:00Z') };
  const appended = [...history, { role: 'user' as const, content: '新的合成问题' }];
  // 固定旧版基线：完整 brain 在前，平台风格插于倒数四条之前。
  const legacy = (v: BrainInput, turns: ChatTurnMessage[]) =>
    assemblePrompt({
      head: brainPrefix(v),
      history: turns,
      inserts: [{ depth: 4, order: 1, text: scenarioNote(v.card!, 'auto', null) }],
      tail: [{ title: '本轮', text: v.now.toISOString() }],
    }).messages;
  const oldCommon = commonChars(wire(legacy(first, history)), wire(legacy(changed, appended)));
  const next = request(changed, appended).messages;
  const newCommon = commonChars(wire(request(first, history).messages), wire(next));
  expect(newCommon - oldCommon).toBeGreaterThan(wire(history).length - 100);
  console.info(
    JSON.stringify({
      syntheticOnly: true,
      oldCommonChars: oldCommon,
      newCommonChars: newCommon,
      requestChars: wire(next).length,
    }),
  );
});

it('大块稳定记忆保留在可复用开头，短对话不把整块内容每轮移到尾部', () => {
  const base = { ...input(), stableMemory: '一条合成事实。'.repeat(800) };
  const first = request(base, [{ role: 'user', content: '合成第一句' }]);
  const next = request(base, [
    { role: 'user', content: '合成第一句' },
    { role: 'assistant', content: '合成回答' },
    { role: 'user', content: '合成第二句' },
  ]);
  expect(first.messages[0]).toEqual(next.messages[0]);
  expect(commonChars(wire(first.messages), wire(next.messages))).toBeGreaterThan(
    base.stableMemory.length,
  );
  expect(next.messages.at(-1)!.content).not.toContain(base.stableMemory);
});
