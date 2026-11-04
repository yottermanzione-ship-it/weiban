import { describe, expect, it } from 'vitest';
import {
  identifierFrom,
  isEntityKey,
  isPublicIdentifier,
  manualEntityKey,
  publicIdentifier,
  publicSourceUrl,
} from './public-identity.js';

describe('公开资料标识（T-20261104e）', () => {
  it('只认「一页一个条目」的地址，取出稳定编号或条目标题', () => {
    expect(publicIdentifier('https://baike.baidu.com/item/%E6%9D%8E%E6%99%A8/1001')).toBe(
      'baike:1001',
    );
    expect(publicIdentifier('https://m.baike.baidu.com/item/李晨/1001?fr=aladdin')).toBe(
      'baike:1001',
    );
    expect(publicIdentifier('https://baike.baidu.com/view/2002.htm')).toBe('baike:2002');
    expect(publicIdentifier('https://baike.sogou.com/v123.htm')).toBe('sogou:123');
    expect(publicIdentifier('https://zh.wikipedia.org/wiki/%E6%9D%8E%E6%99%A8')).toBe(
      'wiki:zh:李晨',
    );
    expect(publicIdentifier('https://zh.m.wikipedia.org/zh-hans/李晨')).toBe('wiki:zh:李晨');
    expect(publicIdentifier('https://www.wikidata.org/wiki/Q123')).toBe('wikidata:Q123');
    expect(publicIdentifier('https://movie.douban.com/celebrity/1274242/')).toBe(
      'douban:celebrity:1274242',
    );
    expect(publicIdentifier('https://bgm.tv/character/77')).toBe('bangumi:character:77');
    expect(publicIdentifier('https://zh.moegirl.org.cn/初音未来')).toBe('moegirl:初音未来');
  });

  it('名字页、消歧义页、搜索 / 分类 / 特殊页、普通网页都不算标识', () => {
    expect(publicIdentifier('https://baike.baidu.com/item/李晨')).toBeNull();
    expect(publicIdentifier('https://zh.wikipedia.org/wiki/李晨_(消歧义)')).toBeNull();
    expect(publicIdentifier('https://zh.wikipedia.org/wiki/Category:演员')).toBeNull();
    expect(publicIdentifier('https://zh.wikipedia.org/wiki/Special:Search')).toBeNull();
    expect(publicIdentifier('https://en.wikipedia.org/wiki/Li_Chen_(disambiguation)')).toBeNull();
    expect(publicIdentifier('https://www.example.com/item/李晨/1001')).toBeNull();
    expect(publicIdentifier('https://user:pw@baike.baidu.com/item/x/1')).toBeNull();
    expect(publicIdentifier('ftp://baike.baidu.com/item/x/1')).toBeNull();
    expect(publicIdentifier('not a url')).toBeNull();
  });

  it('后台既可以贴标识也可以贴地址；实体键 = 标识或 manual:<uuid>', () => {
    expect(identifierFrom(' baike:1001 ')).toBe('baike:1001');
    expect(identifierFrom('https://baike.baidu.com/item/x/1001')).toBe('baike:1001');
    expect(identifierFrom('李晨')).toBeNull();
    expect(isPublicIdentifier('wiki:zh:李晨')).toBe(true);
    expect(isPublicIdentifier('wiki:zh:Category:演员')).toBe(false);
    expect(isPublicIdentifier('baike:1001 <script>')).toBe(false);
    const key = manualEntityKey('00000000-0000-4000-8000-000000000001');
    expect(isEntityKey(key)).toBe(true);
    expect(isEntityKey('manual:李晨')).toBe(false);
  });

  it('后台登记的出处只收公开 http(s) 地址，不收 IP、内网域名和带凭据的地址', () => {
    expect(publicSourceUrl('https://example.com/a#x')).toBe('https://example.com/a');
    expect(publicSourceUrl('http://127.0.0.1/a')).toBeNull();
    expect(publicSourceUrl('http://[::1]/a')).toBeNull();
    expect(publicSourceUrl('http://intranet/a')).toBeNull();
    expect(publicSourceUrl('http://wiki.local/a')).toBeNull();
    expect(publicSourceUrl('https://u:p@example.com/')).toBeNull();
    expect(publicSourceUrl('javascript:alert(1)')).toBeNull();
  });
});
