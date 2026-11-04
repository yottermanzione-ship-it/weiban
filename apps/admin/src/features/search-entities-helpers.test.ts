import { describe, expect, it } from 'vitest';
import {
  aliasActions,
  correctionLabel,
  parseLines,
  parseSourceLines,
  reasonProblem,
  sourcesToText,
} from './search-entities-helpers.js';

describe('搜索身份修正页的输入解析（T-20261104e）', () => {
  it('多行输入去空行、去重', () => {
    expect(parseLines(' a \n\nb\na\n')).toEqual(['a', 'b']);
  });

  it('出处：「标题 | 网址」或只写网址；不是网址的行单独列出', () => {
    const parsed = parseSourceLines(
      '百度百科 | https://baike.baidu.com/item/x/1\nhttps://zh.wikipedia.org/wiki/X\njavascript:alert(1)\n随便写的',
    );
    expect(parsed.sources).toEqual([
      { url: 'https://baike.baidu.com/item/x/1', title: '百度百科' },
      { url: 'https://zh.wikipedia.org/wiki/X', title: '' },
    ]);
    expect(parsed.invalid).toEqual(['javascript:alert(1)', '随便写的']);
    expect(sourcesToText(parsed.sources)).toBe(
      '百度百科 | https://baike.baidu.com/item/x/1\nhttps://zh.wikipedia.org/wiki/X',
    );
  });

  it('别名状态机：待审核可通过 / 驳回，已通过可去掉，已去掉可恢复', () => {
    expect(aliasActions({ status: 'pending', origin: 'admin' })).toEqual(['approve', 'reject']);
    expect(aliasActions({ status: 'approved', origin: 'persona' })).toEqual(['remove']);
    expect(aliasActions({ status: 'blocked', origin: 'persona' })).toEqual(['restore']);
  });

  it('修改原因必填 2～200 字；审计动作有中文名', () => {
    expect(reasonProblem(' ')).not.toBeNull();
    expect(reasonProblem('核对百科')).toBeNull();
    expect(reasonProblem('长'.repeat(201))).not.toBeNull();
    expect(correctionLabel('search.entity_merged')).toBe('合并实体');
    expect(correctionLabel('search.unknown')).toBe('search.unknown');
  });
});
