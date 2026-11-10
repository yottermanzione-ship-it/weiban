import { expect, it } from 'vitest';
import { parseLegacyCard } from '@weiban/contracts';
import { brainText, brainPromptParts } from './brain.js';
import { renderSections } from './prompt-assembly.js';
import { AUTHOR_NOTE_DEPTH, replySceneInstruction, scenarioNote } from './character-prompt.js';
import { legacyScenarioNote } from './legacy-prompt.js';
import { allowedAutomaticStyle } from './persona.js';
import { scenarioFixture, fixtureDigest } from '../tools/scenario-prompt-fixture.js';

// Captured before the scenario changes from the same fixed fixture at a2d04651.
const normalGolden = {
  daily: [
    'ca5f7d53a106275d29b3df6c2fc40915841f80be389e690c648f108ae6ae1880',
    'bb0538090b33b213c4eb939c7d7cf714321635ade6e7a563a5c0a9667ae8be29',
  ],
  auto: [
    '1ea4a852d438aba1b6cbc949fa7d8d0df8e68b4d7b484a5f0a2a32c5923366d3',
    'e3157af10cf5d8452924b795dcc955fdeecc8ed8b5fef914c121bf2050c91b96',
  ],
  treehole: [
    '572b310d9249662cb06e70222b56df0213bc34153d32fc29ac3a45f5f1a15791',
    'bb0538090b33b213c4eb939c7d7cf714321635ade6e7a563a5c0a9667ae8be29',
  ],
  cheer: [
    '6f7329c8f92ad07781a000b87d5ee8232c18bc9e59d4e96333cfb6677d439aad',
    'bb0538090b33b213c4eb939c7d7cf714321635ade6e7a563a5c0a9667ae8be29',
  ],
  tsundere: [
    '85ade8a957362b7fd223542a812f43eb6f50ce87af38e624a62fd27da7cbb01c',
    'bb0538090b33b213c4eb939c7d7cf714321635ade6e7a563a5c0a9667ae8be29',
  ],
  romance: [
    '11b3e85dbd59249501a00b95a2d13a6314ebddd957f987df10e54617dd4de363',
    'bb0538090b33b213c4eb939c7d7cf714321635ade6e7a563a5c0a9667ae8be29',
  ],
} as const;
it.each(Object.keys(normalGolden) as (keyof typeof normalGolden)[])(
  '%s正常状态的整段开头与尾注逐字保持',
  (mode) => {
    const value = scenarioFixture(mode);
    expect(fixtureDigest(brainText(value))).toBe(normalGolden[mode][0]);
    expect(
      fixtureDigest(scenarioNote(value.card!, mode, mode === 'auto' ? '固定自动风格' : null, true)),
    ).toBe(normalGolden[mode][1]);
    expect(brainText({ ...value, stage: { ...value.stage, explicitRomance: true } })).toBe(
      brainText(value),
    );
  },
);
it.each(['daily', 'auto', 'treehole', 'cheer', 'tsundere', 'romance', 'adult'] as const)(
  '%s同阶段与范围的前缀保持稳定，跨日只改变末尾日期',
  (mode) => {
    const value = scenarioFixture(mode),
      first = brainPromptParts(value);
    const next = brainPromptParts({ ...value, now: new Date('2026-11-11T01:00:00Z') });
    expect(renderSections(next.head)).toBe(renderSections(first.head));
    expect(AUTHOR_NOTE_DEPTH).toBe(0);
  },
);
const legacy = parseLegacyCard({
  id: 'fixture-role',
  display_name: '虚构角色程澈',
  core_persona: '虚构成年美术师',
  speaking_style: '温和清晰',
})!;
it('自动模式不绕回后台已停用或不适用的风格', () => {
  for (const style of ['treehole', 'cheer', 'tsundere'] as const) {
    expect(allowedAutomaticStyle(style, ['daily'])).toBe('daily');
    expect(allowedAutomaticStyle(style, ['daily', style])).toBe(style);
  }
  expect(allowedAutomaticStyle(null, ['daily'])).toBeNull();
});
it('新旧卡私密提示一致，切回其他预设后没有残留私密指令', () => {
  const card = scenarioFixture().card!;
  for (const note of [
    scenarioNote(card, 'adult', null, true),
    legacyScenarioNote(legacy, 'adult', null, true),
  ])
    expect(note).toContain('按前文的私密预设直接回应');
  for (const mode of ['daily', 'treehole', 'cheer', 'tsundere', 'romance', 'auto'] as const)
    for (const note of [
      scenarioNote(card, mode, null, true),
      legacyScenarioNote(legacy, mode, null, true),
    ])
      expect(note).not.toContain('按前文的私密预设直接回应');
  for (const mode of ['adult', 'romance'] as const)
    for (const note of [
      scenarioNote(card, mode, null, true, true),
      legacyScenarioNote(legacy, mode, null, true, true),
    ]) {
      expect(note).toContain('亲密表达已暂停');
      expect(note).not.toContain('按前文的私密预设直接回应');
    }
});
it('私人语气不盖过暂停、也不否认真实已达到的恋人进度', () => {
  const value = scenarioFixture('adult');
  const paused = brainText({ ...value, stage: { ...value.stage, romancePaused: true } });
  expect(paused).toContain('亲密表达已暂停');
  expect(paused).not.toContain('本轮语气可以更近');
  expect(paused).not.toContain('【本轮语气】');
  const established = brainText(scenarioFixture('adult', 5));
  expect(established).toContain('你们是恋人：明确的恋爱关系');
  expect(established).not.toContain('【本轮语气】');
});
it('后台自定义预设完整保留，不叠加默认风格', () => {
  const value = scenarioFixture('daily');
  value.scenarioPrompt = 'FIXED_CUSTOM_PRESET：用规划的方式陪伴，但保留事实。';
  expect(brainText(value)).toContain(value.scenarioPrompt);
  expect(brainText(value)).not.toContain('不套用咨询、打气或斗嘴套路');
});
it('私密正文保持连贯，普通拆条和关拆条时的原句不变', () => {
  const base = { voiceCall: false, splitBubbles: true, privateMode: false, maxTextBubbles: 6 };
  const ending =
    '回答前可以先想，想完先单独写一行【正文】，然后只写正文聊天内容；【正文】这行本身不发给用户，正文不能为空。';
  const normal = '现在以角色口吻与用户私聊。只输出聊天纯文本，短句换行，不输出JSON或括号动作。';
  expect(replySceneInstruction(base)).toBe(
    `${normal}正文每一行会单独发成一条消息，一次最多 6 条；话短就一两条，不要为了凑条数硬拆。${ending}`,
  );
  expect(replySceneInstruction({ ...base, splitBubbles: false })).toBe(normal + ending);
  expect(replySceneInstruction({ ...base, privateMode: true })).toContain(
    '一次 2～3 条，每条 10～25 字',
  );
  expect(replySceneInstruction({ ...base, privateMode: true })).not.toContain('短句换行');
  expect(replySceneInstruction({ ...base, privateMode: true, splitBubbles: false })).not.toContain(
    '2～3',
  );
  expect(replySceneInstruction({ ...base, voiceCall: true, privateMode: true })).toBe(
    replySceneInstruction({ ...base, voiceCall: true }),
  );
});
