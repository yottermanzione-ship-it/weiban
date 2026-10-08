import { expect, it } from 'vitest';
import { publicKnowledge } from './knowledge.js';
const base = {
  id: 'fact',
  title: '公开作品',
  category: 'work' as const,
  keys: ['作品'],
  content: '唯一公开作品是灯塔',
  confidence: 'verified' as const,
};
it('世界书关键词/次关键词/有效期与常驻项，真人不读用户或虚构来源', () => {
  const entries = [
    base,
    { ...base, id: 'secondary', selective: true, secondaryKeys: ['灯塔'] },
    { ...base, id: 'expired', validTo: '2026-01-01' },
    { ...base, id: 'future', validFrom: '2027-01-01' },
    { ...base, id: 'user', confidence: 'userSource' as const },
    { ...base, id: 'constant', constant: true, keys: [] },
  ];
  expect(publicKnowledge(entries, '作品有哪些', '2026-10-08', true).map((e) => e.id)).toEqual([
    'fact',
    'constant',
  ]);
  expect(publicKnowledge(entries, '灯塔作品', '2026-10-08', true).map((e) => e.id)).toEqual([
    'fact',
    'secondary',
    'constant',
  ]);
  expect(publicKnowledge(entries, '不存在的作品', '2026-10-08', false).map((e) => e.id)).toContain(
    'user',
  );
});
