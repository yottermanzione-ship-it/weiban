import { describe, expect, it } from 'vitest';
import {
  loadKnowledgeBase,
  matchEntry,
  normalizeQuestion,
  renderAnswer,
  type KnowledgeBaseFile,
} from './knowledge-base.js';

describe('小V知识库数据文件', () => {
  it('加载成功：条目唯一、确定性条目有答案、模型条目有指引', () => {
    const kb = loadKnowledgeBase();
    expect(kb.version).toBe(1);
    expect(kb.entries.length).toBeGreaterThan(10);
    const ids = new Set(kb.entries.map((e) => e.id));
    expect(ids.size).toBe(kb.entries.length);
    for (const entry of kb.entries) {
      if (entry.deterministic) expect(entry.answer).toBeTruthy();
      else expect(entry.guidance).toBeTruthy();
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it('确定性答案里没有成本价/内部编号等红线词', () => {
    const kb = loadKnowledgeBase();
    const facts = {
      pointsBalance: '1234',
      contactCount: '3',
      contactLimit: '50',
      membershipTier: '免费',
      membershipExpiresAt: null,
      membershipPlans: '月卡 20 元 / 1 个月，首次 12.9 元，开通赠 2000 积分',
      rechargeTiers: '10 元、30 元、100 元，不赠送',
      signupBonus: '100',
    };
    for (const entry of kb.entries) {
      if (!entry.deterministic) continue;
      const rendered = renderAnswer(entry, facts);
      expect(rendered).toBeTruthy();
      expect(rendered).not.toMatch(/成本价|上游价|内部编号|API key/i);
    }
  });
});

describe('知识库匹配', () => {
  const kb = loadKnowledgeBase();

  it('会员价格问题命中价格条目', () => {
    expect(matchEntry(kb, 'PRO+多少钱？')?.entry.id).toBe('kb-membership-prices');
    expect(matchEntry(kb, '会员有几档')?.entry.id).toBe('kb-membership-tiers');
  });

  it('忘记密码命中未知条目（不得编步骤）', () => {
    const hit = matchEntry(kb, '忘记密码怎么办？');
    expect(hit?.entry.id).toBe('kb-password-reset');
    expect(hit?.entry.unknown).toBe(true);
  });

  it('敏感事项命中微信口径条目', () => {
    expect(matchEntry(kb, '我要退款')?.entry.id).toBe('kb-sensitive');
  });

  it('无匹配返回 null（走通用模型路径）', () => {
    expect(matchEntry(kb, '今天天气怎么样')).toBeNull();
    expect(matchEntry(kb, '   ')).toBeNull();
  });

  it('停用条目永不命中', () => {
    const disabled: KnowledgeBaseFile = {
      ...kb,
      entries: kb.entries.map((e) =>
        e.id === 'kb-membership-prices' ? { ...e, enabled: false } : e,
      ),
    };
    expect(matchEntry(disabled, '会员多少钱')?.entry.id).not.toBe('kb-membership-prices');
  });

  it('归一化：全角/大小写/标点不影响匹配', () => {
    expect(normalizeQuestion('会员多少钱？')).toBe('会员多少钱');
    expect(matchEntry(kb, '会员多少钱？？')?.entry.id).toBe('kb-membership-prices');
  });
});

describe('模板渲染', () => {
  const kb = loadKnowledgeBase();
  const entry = kb.entries.find((e) => e.id === 'kb-contact-limit')!;

  it('占位符按简报事实填充', () => {
    expect(renderAnswer(entry, { contactCount: '7', contactLimit: '50' })).toContain(
      '你现在加了 7 个',
    );
    expect(renderAnswer(entry, { contactCount: '7', contactLimit: '50' })).toContain(
      '上限是 50 个',
    );
  });

  it('占位符缺值时返回 null（降级走模型，不硬答）', () => {
    expect(renderAnswer(entry, { contactCount: null, contactLimit: '50' })).toBeNull();
  });

  it('白名单外的占位符渲染失败', () => {
    const bad = { ...entry, answer: '成本是 {{costPrice}} 元' };
    expect(renderAnswer(bad, { costPrice: '1' })).toBeNull();
  });
});
