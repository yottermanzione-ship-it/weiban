import { describe, expect, it } from 'vitest';
import { legacyKnowledgeEntries, legacyDialogueExamples, parseLegacyCard } from './legacy-card.js';

/** 合成旧卡：字段名与旧库 characters_v2 保持一致，不转新卡。 */
const raw = {
  id: '5f0f6a5e-3f6c-4f0e-9d3a-2b1c0d9e8f70',
  display_name: '程澈',
  nickname: '小程',
  canonical_name: '程澈',
  aliases_json: '["阿澈","程老师"]',
  signature: '画画的人，偶尔发呆',
  identity_type: 'fictional',
  identity_gender: 'male',
  identity_birthday: '1994-03-02',
  core_persona: '独立游戏美术，住在海边小城，习惯熬夜改稿。',
  soul_personality: '内敛、慢热，熟了以后话很多',
  soul_emotional_tone: '温暖克制，低落时先沉默一会儿',
  soul_relationship_mode: '先观察，再靠近',
  relationship_mode: '慢热型',
  speaking_style: '短句，偶尔冷幽默，不解释太多',
  style_chat_style: '微信聊天，喜欢用省略号',
  style_emoji_level: '少',
  style_avoid_json: '["哈哈大笑了","亲亲","宝贝"]',
  knowledge_json: { notes: ['灯塔项目', '海边长大'] },
  opening_messages_json: '["在吗？我刚画完一张图。","嗯，来了。"]',
  group_chat_json: {
    group_style: '话不多，但会接梗',
    talkativeness: 35,
    hobbies: ['画画', '看海'],
    group_name_style: '随便一点，别太正式',
  },
  moment_profile_json: {
    tone: '生活化，偶尔自嘲',
    topics: ['画画', '海边的天气'],
    comment_style: '熟人面前毒舌',
    frequency_per_week: [2, 3],
  },
  voice_json: { provider: 'qwen', voice_id: 'qwen-old-voice-1' },
  qwen_voice_id: 'qwen-old-voice-1',
  is_official: 0,
};

describe('旧卡读取模块', () => {
  it('原样读出旧字段，不做字段改名', () => {
    const card = parseLegacyCard(raw)!;
    expect(card.raw).toBe(raw);
    expect(card.displayName).toBe('程澈');
    expect(card.nickname).toBe('小程');
    expect(card.aliases).toEqual(['阿澈', '程老师']);
    expect(card.signature).toBe('画画的人，偶尔发呆');
    expect(card.corePersona).toBe('独立游戏美术，住在海边小城，习惯熬夜改稿。');
    expect(card.soulPersonality).toContain('内敛');
    expect(card.soulEmotionalTone).toContain('温暖克制');
    expect(card.soulRelationshipMode).toBe('先观察，再靠近');
    expect(card.relationshipMode).toBe('慢热型');
    expect(card.speakingStyle).toContain('短句');
    expect(card.styleChatStyle).toContain('省略号');
    expect(card.styleEmojiLevel).toBe('少');
    expect(card.styleAvoid).toEqual(['哈哈大笑了', '亲亲', '宝贝']);
    expect(card.knowledgeJson).toEqual({ notes: ['灯塔项目', '海边长大'] });
    expect(card.openingMessages).toEqual(['在吗？我刚画完一张图。', '嗯，来了。']);
    expect(card.identityType).toBe('fictional');
    expect(card.identityGender).toBe('male');
    expect(card.identityBirthday).toBe('1994-03-02');
  });

  it('群聊 / 朋友圈 / 音色取旧字段', () => {
    const card = parseLegacyCard(raw)!;
    expect(card.groupChat.style).toContain('接梗');
    expect(card.groupChat.talkativeness).toBe(35);
    expect(card.groupChat.hobbies).toBe('画画、看海');
    expect(card.momentProfile.tone).toContain('生活化');
    expect(card.momentProfile.topics).toEqual(['画画', '海边的天气']);
    expect(card.momentProfile.commentStyle).toContain('毒舌');
    expect(card.momentProfile.frequencyPerWeek).toEqual([2, 3]);
    expect(card.qwenVoiceId).toBe('qwen-old-voice-1');
    expect(card.voiceIds[0]).toBe('qwen-old-voice-1');
  });

  it('坏值 / 空值不伪装成旧卡；附属表行原样解析', () => {
    expect(parseLegacyCard(null)).toBeNull();
    expect(parseLegacyCard('')).toBeNull();
    expect(parseLegacyCard({})).toBeNull();
    const entries = legacyKnowledgeEntries([
      {
        id: 'k1',
        trigger_keys_json: '["灯塔","守灯人"]',
        content: '灯塔项目是程澈的作品。',
        priority: 5,
      },
      { id: 'k2', trigger_keys_json: '[]', content: '常驻设定', constant: true },
      { content: '没有 id，跳过' },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.keys).toEqual(['灯塔', '守灯人']);
    expect(entries[1]?.constant).toBe(true);
    const examples = legacyDialogueExamples([
      { id: 'e2', user_text: '在吗', assistant_text: '嗯。', scene: '日常', sort_order: 2 },
      { id: 'e1', user_text: '早', assistant_text: '早。', scene: '打招呼', sort_order: 1 },
    ]);
    expect(examples.map((example) => example.id)).toEqual(['e1', 'e2']);
    expect(examples[0]?.scene).toBe('打招呼');
  });
});
