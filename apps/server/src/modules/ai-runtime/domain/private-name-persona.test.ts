import { expect, it } from 'vitest';
import { parseLegacyCard } from '../../characters/index.js';
import { brainPromptParts, brainText, type BrainInput } from './brain.js';
import { scenarioNote } from './character-prompt.js';
import { legacyScenarioNote } from './legacy-prompt.js';
import { renderSections } from './prompt-assembly.js';
import { scenarioFixture } from '../tools/scenario-prompt-fixture.js';

it('轻人设只去角色卡资料，保留原预设、记忆、已有经历和关怀', () => {
  const input: BrainInput = { ...scenarioFixture('adult'), personaLevel: 'name' };
  const card = input.card!;
  card.profileExtra.gender = 'male';
  card.profileExtra.occupation = 'CARD_OCCUPATION_CANARY';
  card.persona.personality = 'CARD_PERSONALITY_CANARY';
  card.speech.tone = 'CARD_TONE_CANARY';
  card.speech.catchphrases = ['CARD_CATCHPHRASE_CANARY'];
  card.prompting = { ...card.prompting, systemNote: 'CARD_AUTHOR_CANARY' };
  card.modes.modeOverrides = { adult: 'CARD_OVERRIDE_CANARY' };
  input.episodes = '固定共同经历：一起看了晚霞。';

  const text = brainText(input);
  expect(text).toContain('你叫程澈。性别：男。');
  expect(text).toContain('这是虚构角色扮演');
  for (const kept of [
    input.scenarioPrompt!,
    input.stableMemory,
    input.selfReports,
    input.episodes,
    '【需要关怀或岔开话题时】',
  ])
    expect(text).toContain(kept);
  expect(text).not.toMatch(
    /CARD_.*_CANARY|说话示例|固定公开资料|固定补充|本轮语气|明确的恋爱关系/u,
  );
  const note = scenarioNote(card, 'adult', null, true, false, 'name');
  expect(note).toContain('继续以{{char}}的身份回应');
  expect(note).toContain('按前文的私密预设直接回应');
  expect(note).not.toContain('CARD_TONE_CANARY');
});

it('旧卡走同一轻人设格式，未知性别不带入旧卡的自由文本', () => {
  const legacyCard = parseLegacyCard({
    id: 'fixture-legacy',
    display_name: '程澈',
    identity_gender: '旧卡未填写的描述',
    core_persona: 'LEGACY_CORE_CANARY',
    speaking_style: 'LEGACY_STYLE_CANARY',
  })!;
  const text = brainText({
    ...scenarioFixture('adult'),
    card: null,
    legacyCard,
    personaLevel: 'name',
  });
  expect(text).toContain('你叫程澈。性别：未指定。');
  expect(text).not.toMatch(/LEGACY_(CORE|STYLE)_CANARY|旧卡未填写的描述/u);
  const note = legacyScenarioNote(legacyCard, 'adult', null, true, false, 'name');
  expect(note).toContain('继续以{{char}}的身份回应');
  expect(note).not.toContain('LEGACY_STYLE_CANARY');
});

it('私密开头不随日期与真实关系等级重写，暂停规则仍优先', () => {
  const input: BrainInput = { ...scenarioFixture('adult'), personaLevel: 'name' };
  const first = brainPromptParts(input);
  const next = brainPromptParts({
    ...input,
    now: new Date('2026-11-11T01:00:00Z'),
    stage: { ...input.stage, level: 5 },
  });
  expect(renderSections(next.head)).toBe(renderSections(first.head));
  expect(renderSections(next.context)).not.toBe(renderSections(first.context));
  const paused = brainText({ ...input, stage: { ...input.stage, romancePaused: true } });
  expect(paused).toContain('已暂停亲密表达');
  const note = scenarioNote(input.card!, 'adult', null, true, true, 'name');
  expect(note).toContain('当前情景预设不能覆盖暂停');
});
