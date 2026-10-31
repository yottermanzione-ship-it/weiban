import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from './knowledge-base.js';
import { buildSystemPrompt, sanitizeReply, toModelMessages } from './prompt.js';

describe('客服提示词', () => {
  const kb = loadKnowledgeBase();

  it('包含硬红线：成本价、内部编号、微信口径、未知口径', () => {
    const prompt = buildSystemPrompt({ briefLines: ['会员档位：免费'], matched: null });
    expect(prompt).toContain('成本价');
    expect(prompt).toContain('xingliubuji');
    expect(prompt).toContain('没有人工接管');
    expect(prompt).toContain('会员档位：免费');
    expect(prompt).toContain('不是真人');
  });

  it('简报查不到时注明不要编', () => {
    const prompt = buildSystemPrompt({ briefLines: [], matched: null });
    expect(prompt).toContain('没能查到用户状态');
  });

  it('未知条目注入未知口径要求', () => {
    const unknown = kb.entries.find((e) => e.id === 'kb-password-reset')!;
    const prompt = buildSystemPrompt({ briefLines: [], matched: unknown });
    expect(prompt).toContain('没有核实到');
    expect(prompt).toContain(unknown.id);
  });

  it('匹配条目的指引注入提示词', () => {
    const entry = kb.entries.find((e) => e.id === 'kb-add-contact')!;
    const prompt = buildSystemPrompt({ briefLines: [], matched: entry });
    expect(prompt).toContain('恢复以前的记录');
  });
});

describe('模型输出后处理', () => {
  it('空输出返回 null（调用方改发固定失败文案）', () => {
    expect(sanitizeReply('   \n ')).toBeNull();
  });

  it('短回复原样返回（去空白）', () => {
    expect(sanitizeReply('  你好呀～ ')).toBe('你好呀～');
  });

  it('超长回复在句末截断', () => {
    const long = `${'这是很长的一句回答。'.repeat(200)}尾巴`;
    const result = sanitizeReply(long)!;
    expect(result.length).toBeLessThanOrEqual(1800);
    expect(result.endsWith('。')).toBe(true);
  });
});

describe('历史转模型消息', () => {
  it('用户消息 role=user、官方回复 role=assistant', () => {
    const messages = toModelMessages([
      { senderKind: 'user', text: '你好' },
      { senderKind: 'official', text: '你好呀' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' },
    ]);
  });
});
