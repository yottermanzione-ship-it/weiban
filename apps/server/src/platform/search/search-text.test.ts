import { describe, expect, it } from 'vitest';
import {
  analyzeQuery,
  editDistance,
  escapeLikePattern,
  pinyinKeys,
  scoreTerm,
  searchKey,
  termRecord,
  typoKind,
  uniqueTerms,
  type SearchTermKind,
} from './search-text.js';

const term = (text: string, kind: SearchTermKind = 'name') => termRecord(text, kind)!;
const q = (text: string) => analyzeQuery(text)!;

describe('站内搜索文字处理', () => {
  it('标准化只做 NFKC、大小写、空白和固定标点，不去姓氏后缀', () => {
    expect(searchKey('  Ｊａｃｋｓｏｎ　Yee ')).toBe('jacksonyee');
    expect(searchKey('迪丽热巴·迪力木拉提')).toBe('迪丽热巴迪力木拉提');
    expect(searchKey('李晨（演员）')).toBe('李晨演员');
    expect(searchKey('李晨')).not.toBe(searchKey('李'));
    expect(analyzeQuery('   ')).toBeNull();
    expect(analyzeQuery('，。！')).toBeNull();
  });

  it('拼音和首字母在本地生成', () => {
    expect(pinyinKeys('易烊千玺')).toEqual({ pinyin: 'yiyangqianxi', initials: 'yyqx' });
    expect(pinyinKeys('Jackson Yee')).toEqual({ pinyin: '', initials: '' });
    expect(pinyinKeys('TFBOYS易烊千玺').initials).toBe('tfboysyyqx');
  });

  it('超长输入截断到 64 字，并标记 tooLong', () => {
    const long = q('啊'.repeat(80));
    expect(long.chars).toBe(64);
    expect(long.tooLong).toBe(true);
    expect(q('易烊千玺').tooLong).toBe(false);
  });

  it('三层分数：精确 > 别名 > 前缀 > 拼音 / 首字母 > 包含 > 关键词', () => {
    const name = term('易烊千玺');
    const alias = term('千玺', 'alias');
    expect(scoreTerm(q('易烊千玺'), name)).toEqual({ score: 100, match: 'exact' });
    expect(scoreTerm(q('千玺'), alias)).toEqual({ score: 96, match: 'exact' });
    expect(scoreTerm(q('易烊千'), name)?.match).toBe('prefix');
    expect(scoreTerm(q('yiyangqianxi'), name)).toEqual({ score: 74, match: 'pinyin' });
    expect(scoreTerm(q('yiyang'), name)).toEqual({ score: 70, match: 'pinyin' });
    expect(scoreTerm(q('yyqx'), name)).toEqual({ score: 72, match: 'initials' });
    expect(scoreTerm(q('千玺'), name)?.match).toBe('contains');
    expect(scoreTerm(q('少年的你'), term('少年的你', 'keyword'))?.score).toBe(50);
    const prefix = scoreTerm(q('易烊千'), name)!.score;
    expect(prefix).toBeLessThan(96);
    expect(prefix).toBeGreaterThan(74);
  });

  it('英文别名按前缀命中', () => {
    expect(scoreTerm(q('jackson'), term('Jackson Yee', 'alias'))?.match).toBe('prefix');
    expect(scoreTerm(q('Jackson Yee'), term('Jackson Yee', 'alias'))?.match).toBe('exact');
  });

  it('只有一个字：只认精确和前缀，不做拼音、首字母和包含', () => {
    expect(scoreTerm(q('李'), term('李晨'))?.match).toBe('prefix');
    expect(scoreTerm(q('晨'), term('李晨'))).toBeNull();
    expect(scoreTerm(q('y'), term('易烊千玺'))).toBeNull();
    expect(scoreTerm(q('少'), term('少年的你', 'keyword'))).toBeNull();
  });

  it('错字只给建议：同音优先，2 字名字不认任意替换', () => {
    expect(typoKind(q('易洋千玺'), term('易烊千玺'))).toBe('homophone');
    expect(typoKind(q('厉晨'), term('李晨'))).toBe('homophone');
    // 至少 3 字时同音前缀也算；2 字不算（「李成」不提示「李晨阳」）。
    expect(typoKind(q('易洋千'), term('易烊千玺'))).toBe('homophone');
    expect(typoKind(q('厉晨'), term('李晨阳'))).toBeNull();
    expect(typoKind(q('李明'), term('李晨'))).toBeNull();
    expect(typoKind(q('易烊干玺'), term('易烊千玺'))).toBe('edit');
    expect(typoKind(q('易千烊玺'), term('易烊千玺'))).toBe('edit');
    expect(typoKind(q('yiyangqianxu'), term('易烊千玺'))).toBe('edit');
    expect(typoKind(q('易烊千'), term('易烊千玺'))).toBeNull();
    expect(typoKind(q('易烊千玺'), term('易烊千玺'))).toBeNull();
    expect(typoKind(q('少年的妳'), term('少年的你', 'keyword'))).toBeNull();
  });

  it('编辑距离按码点、相邻换位算一处、超界提前返回', () => {
    expect(editDistance('易烊千玺', '易烊千玺')).toBe(0);
    expect(editDistance('易烊千玺', '易千烊玺')).toBe(1);
    expect(editDistance('易烊千玺', '易烊')).toBe(2);
    expect(editDistance('abc', 'xyz')).toBe(2);
  });

  it('LIKE 转义与词条去重', () => {
    expect(escapeLikePattern('50%_a\\b')).toBe('50\\%\\_a\\\\b');
    const deduped = uniqueTerms([term('千玺', 'keyword'), term('千玺', 'alias'), term('易烊千玺')]);
    expect(deduped.map((t) => `${t.kind}:${t.key}`).sort()).toEqual([
      'alias:千玺',
      'name:易烊千玺',
    ]);
  });
});
