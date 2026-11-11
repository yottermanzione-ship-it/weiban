import { describe, expect, it } from 'vitest';
import { looksLikeMetaReasoning } from './reply-rules.js';

const META_SAMPLES = [
  '我们需要回答群聊。需要判断角色。没有指定是谁。',
  '用户给我发了今天日常的事实底稿，还有个系统提示要我自己主动发起聊天。',
  'user and assistant chatting in Chinese. Assistant is a persona? Need send...',
];

describe('角色消息的元思考检查', () => {
  it.each(META_SAMPLES.map((text, index) => ({ text, index: index + 1 })))(
    '拦住合成思考样例 $index',
    ({ text }) => {
      expect(looksLikeMetaReasoning(text)).toBe(true);
    },
  );

  it.each([
    '行，那我先睡了，明天聊。',
    '你今天怎么这么晚还在线？',
    '群里都在，我先说一句。',
    '我们先吃饭吧，菜要凉了。',
    '我们先接孩子，晚点给你回复。',
    '我们先选角色再开黑。',
    'Let me know when you get home.',
    'I should get some sleep.',
    'I should answer my phone, then I will check the group chat.',
  ])('放行普通台词', (text) => {
    expect(looksLikeMetaReasoning(text)).toBe(false);
  });

  it('按不同标记计数，短消息中只重复一个标记不拦截', () => {
    expect(looksLikeMetaReasoning('刚看了系统提示。没有指定是谁。')).toBe(true);
    expect(looksLikeMetaReasoning('刚看了系统提示。那个系统提示更新了。')).toBe(false);
  });

  it('长文需要至少一个思考标记', () => {
    const short = '好'.repeat(395) + '系统提示';
    expect(looksLikeMetaReasoning(short)).toBe(false);
    expect(looksLikeMetaReasoning(short + '。')).toBe(true);
    expect(looksLikeMetaReasoning('好'.repeat(400))).toBe(false);
  });

  it('检查独立气泡的开头，也识别模型写成字面的换行', () => {
    expect(looksLikeMetaReasoning('晚上好。\\n我们需要回答群聊。')).toBe(true);
  });

  it('只检查正文标记之后实际会发出的内容', () => {
    expect(looksLikeMetaReasoning(`${META_SAMPLES[0]}\n【正文】行，那我先睡了，明天聊。`)).toBe(
      false,
    );
  });
});
