import { describe, expect, it } from 'vitest';
import { parseLegacyCard, type LegacyDialogueExample } from '@weiban/contracts';
import { brainText, type BrainInput } from './brain.js';
import {
  legacyCoreText,
  legacyExamplesText,
  legacyLorebook,
  legacyPinnedExamples,
  legacyScenarioNote,
  legacySpeechText,
} from './legacy-prompt.js';

/** 合成旧卡（characters_v2 字段原样）。 */
const legacy = parseLegacyCard({
  id: '5f0f6a5e-3f6c-4f0e-9d3a-2b1c0d9e8f70',
  display_name: '程澈',
  nickname: '小程',
  aliases_json: '["阿澈"]',
  signature: '画画的人',
  core_persona: 'CORE-PERSONA-CANARY：独立游戏美术，住在海边小城，习惯熬夜改稿。',
  soul_personality: '内敛、慢热',
  soul_emotional_tone: '温暖克制',
  soul_relationship_mode: '先观察，再靠近',
  relationship_mode: '慢热型',
  speaking_style: '短句，偶尔冷幽默',
  style_chat_style: '微信聊天，喜欢省略号',
  style_emoji_level: '少',
  style_avoid_json: '["宝贝"]',
  opening_messages_json: '["在吗？"]',
  group_chat_json: { group_style: 'GROUP-STYLE-CANARY', talkativeness: 35, hobbies: ['画画'] },
  moment_profile_json: { tone: 'MOMENT-TONE-CANARY', topics: ['画画'] },
  voice_json: { voice_id: 'qwen-voice-canary' },
  qwen_voice_id: 'qwen-voice-canary',
})!;

const examples: LegacyDialogueExample[] = [
  { id: 'e1', scene: '打招呼', userText: '在吗', assistantText: '嗯。', sortOrder: 1 },
  { id: 'e2', scene: '日常', userText: '今天画了什么', assistantText: '一张海。', sortOrder: 2 },
  { id: 'e3', scene: '打招呼', userText: '早', assistantText: '早。', sortOrder: 3 },
];

function input(): BrainInput {
  return {
    name: '程澈',
    card: null,
    legacyCard: legacy,
    legacyExamples: examples,
    policy: { isMinor: false, isRealPerson: true, romanceAllowed: true, adultModeEligible: false },
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
    constantKnowledge: '· 灯塔项目：程澈的作品。',
    supplement: '',
    selfReports: '',
    stableMemory: '',
  };
}

describe('旧卡提示词直读', () => {
  it('core_persona 原文进稳定开头，不出现平台规则护栏', () => {
    const text = brainText(input());
    expect(text).toContain('CORE-PERSONA-CANARY');
    expect(text).toContain('温暖克制');
    expect(text).toContain('短句，偶尔冷幽默');
    expect(text).not.toMatch(/AUTHOR_GUARD|以平台规则为准|平台规则优先|受平台规则约束/u);
  });

  it('说话方式 / 示例 / 世界书 / 情景提示都取旧字段', () => {
    expect(legacyCoreText(legacy)).toContain('CORE-PERSONA-CANARY');
    expect(legacySpeechText(legacy)).toContain('微信聊天，喜欢省略号');
    expect(legacyExamplesText(examples)).toContain('对方：今天画了什么');
    const pinned = legacyPinnedExamples(examples, { max: 2 });
    expect(pinned.map((example) => example.scene)).toEqual(['打招呼', '日常']);
    const lore = legacyLorebook(
      [
        {
          id: 'k1',
          title: '',
          keys: ['灯塔'],
          secondaryKeys: [],
          constant: false,
          priority: 1,
          content: '灯塔项目。',
        },
        {
          id: 'k2',
          title: '',
          keys: [],
          secondaryKeys: [],
          constant: true,
          priority: 0,
          content: '常驻。',
        },
      ],
      '今天聊到灯塔',
    );
    expect(lore.constant.map((entry) => entry.id)).toEqual(['k2']);
    expect(lore.triggered.map((entry) => entry.id)).toEqual(['k1']);
    expect(legacyScenarioNote(legacy, 'daily', null)).toContain('短句，偶尔冷幽默');
  });

  it('群聊 / 朋友圈 / 音色能直接取旧字段', () => {
    expect(legacy.groupChat.style).toBe('GROUP-STYLE-CANARY');
    expect(legacy.groupChat.talkativeness).toBe(35);
    expect(legacy.momentProfile.tone).toBe('MOMENT-TONE-CANARY');
    expect(legacy.momentProfile.topics).toEqual(['画画']);
    expect(legacy.voiceIds[0]).toBe('qwen-voice-canary');
  });
});
