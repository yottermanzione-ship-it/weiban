import { expect, it } from 'vitest';
import { joinPersonaText, splitPersonaText } from './persona-text-sections.js';
it('中文标签分段无损往返，保留CRLF、未知字段和空白', () => {
  for (const source of [
    '',
    '没有标签的原文\n未知字段：保留',
    '人物资料\r\n身份： 创作者\r\n\r\n人格核心: 内敛\r\n未识别字段：必须保留\r\n默认回复： 自然\r\n',
  ])
    expect(joinPersonaText(splitPersonaText(source))).toBe(source);
});
it('只改一个场景态度，不改其他分区或原有标签', () => {
  const source = '身份：原创人物\n默认回复：自然\n冷淡回复：克制\n越界回复：说明立场\n';
  const doc = splitPersonaText(source);
  expect(doc.parts.map((p) => p.label)).toEqual(['身份', '默认回复', '冷淡回复', '越界回复']);
  doc.parts.find((p) => p.label === '冷淡回复')!.text = '温和说明距离';
  expect(joinPersonaText(doc)).toBe(source.replace('冷淡回复：克制', '冷淡回复：温和说明距离'));
});
