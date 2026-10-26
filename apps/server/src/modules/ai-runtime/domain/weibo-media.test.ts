import { describe, expect, it } from 'vitest';
import { weiboPostUrl } from './weibo.js';
import {
  weiboGateHit,
  weiboImageKey,
  weiboMediaFromPage,
  weiboPageAllowed,
  weiboPickImage,
} from './weibo-media.js';

const POST = 'https://weibo.com/1234567890/AbCdEf';
const OTHER = 'https://weibo.com/1234567890/ZZZZZZ';
const expectation = {
  postUrl: POST,
  authorId: '1234567890',
  nickname: '林晚',
  now: new Date('2026-10-25T10:00:00Z'),
};

function page(overrides: Record<string, string | null> = {}) {
  const meta = (name: string, value: string | null) =>
    value === null ? '' : `<meta property="${name}" content="${value}">`;
  const values: Record<string, string | null> = {
    'og:url': POST,
    'article:author': 'https://weibo.com/1234567890',
    'og:image': 'https://wx1.sinaimg.cn/large/a.jpg',
    'article:published_time': '2026-10-23T12:00:00Z',
    'og:description': '林晚：今天收工早。',
    ...overrides,
  };
  return Object.entries(values)
    .map(([name, value]) => meta(name, value))
    .join('\n');
}

describe('微博帖子页面的图片解析', () => {
  it('只取该帖自己的图片：og:image 打头，pics 数组里的同帖图片补齐，去重后最多 4 张', () => {
    const html =
      page() +
      '<script>"pics":[{"url":"https://wx1.sinaimg.cn/large/a.jpg?ssl=1"},{"url":"https://wx2.sinaimg.cn/large/b.jpg"},{"url":"https:\\/\\/wx3.sinaimg.cn\\/large\\/c.jpg"},{"url":"https://wx4.sinaimg.cn/large/d.jpg"},{"url":"https://wx5.sinaimg.cn/large/e.jpg"}]</script>';
    const result = weiboMediaFromPage(html, expectation, weiboPostUrl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.images.map((image) => image.sourceUrl)).toEqual([
      'https://wx1.sinaimg.cn/large/a.jpg',
      'https://wx2.sinaimg.cn/large/b.jpg',
      'https://wx3.sinaimg.cn/large/c.jpg',
      'https://wx4.sinaimg.cn/large/d.jpg',
    ]);
    expect(result.images.map((image) => image.position)).toEqual([0, 1, 2, 3]);
    expect(result.caption).toContain('今天收工早');
    expect(result.publishedAt).toBe('2026-10-23T12:00:00.000Z');
  });

  it('页面没有任何图片时照实拒绝（上游只发文字，不换替代图）', () => {
    expect(weiboMediaFromPage(page({ 'og:image': null }), expectation, weiboPostUrl)).toEqual({
      ok: false,
      reason: 'no_image',
    });
  });

  it('不是这条帖子、不是这个账号、时间核不上：一律拒绝', () => {
    expect(weiboMediaFromPage(page({ 'og:url': OTHER }), expectation, weiboPostUrl)).toEqual({
      ok: false,
      reason: 'page_url_mismatch',
    });
    expect(
      weiboMediaFromPage(
        page({ 'article:author': 'https://weibo.com/999' }),
        expectation,
        weiboPostUrl,
      ),
    ).toEqual({ ok: false, reason: 'author_mismatch' });
    expect(
      weiboMediaFromPage(page({ 'article:published_time': '昨天' }), expectation, weiboPostUrl),
    ).toEqual({ ok: false, reason: 'time_unverified' });
    expect(
      weiboMediaFromPage(
        page({ 'article:published_time': '2025-01-01T00:00:00Z' }),
        expectation,
        weiboPostUrl,
      ),
    ).toEqual({ ok: false, reason: 'time_unverified' });
  });

  it('坏域 / http / data: 图片地址一律不认；pics 里的外站图片也不认', () => {
    expect(
      weiboMediaFromPage(
        page({ 'og:image': 'https://evil.example/a.jpg' }),
        expectation,
        weiboPostUrl,
      ),
    ).toEqual({ ok: false, reason: 'image_host_rejected' });
    expect(
      weiboMediaFromPage(
        page({ 'og:image': 'http://wx1.sinaimg.cn/a.jpg' }),
        expectation,
        weiboPostUrl,
      ),
    ).toEqual({ ok: false, reason: 'image_host_rejected' });
    expect(
      weiboMediaFromPage(
        page({ 'og:image': 'data:image/png;base64,AAAA' }),
        expectation,
        weiboPostUrl,
      ),
    ).toEqual({ ok: false, reason: 'image_host_rejected' });
    const html =
      page() +
      '<script>"pics":[{"url":"https://evil.example/a.jpg"},{"url":"https://wx2.sinaimg.cn/large/b.jpg"}]</script>';
    const result = weiboMediaFromPage(html, expectation, weiboPostUrl);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.images.map((image) => image.sourceUrl)).toEqual([
        'https://wx1.sinaimg.cn/large/a.jpg',
        'https://wx2.sinaimg.cn/large/b.jpg',
      ]);
  });

  it('图片摘要按域名+路径算：签名查询串不同仍是同一张图；外站/http 没有摘要', () => {
    expect(weiboImageKey('https://wx1.sinaimg.cn/large/a.jpg?ssl=1')).toBe(
      weiboImageKey('https://wx1.sinaimg.cn/large/a.jpg?token=2'),
    );
    expect(weiboImageKey('https://wx1.sinaimg.cn/large/a.jpg')).not.toBe(
      weiboImageKey('https://wx1.sinaimg.cn/large/b.jpg'),
    );
    expect(weiboImageKey('https://evil.example/a.jpg')).toBeNull();
    expect(weiboImageKey('http://wx1.sinaimg.cn/a.jpg')).toBeNull();
    expect(weiboImageKey('https://weibo.com/u/123')).toBeNull();
  });

  it('微博访客/反爬拦截能被识别（302 到 visitor/passport、432、访客页）', () => {
    expect(
      weiboGateHit({
        status: 302,
        finalUrl: 'https://visitor.passport.weibo.cn/visitor/visitor?entry=sinawap',
      }),
    ).toBe(true);
    expect(
      weiboGateHit({
        status: 302,
        finalUrl: 'https://passport.weibo.com/visitor/visitor?entry=miniblog',
      }),
    ).toBe(true);
    expect(weiboGateHit({ status: 432, finalUrl: POST })).toBe(true);
    expect(
      weiboGateHit({ status: 200, finalUrl: POST, html: '<title>Sina Visitor System</title>' }),
    ).toBe(true);
    expect(weiboGateHit({ status: 200, finalUrl: POST, html: page() })).toBe(false);
    expect(weiboPageAllowed(POST)).toBe(true);
    expect(weiboPageAllowed('https://m.weibo.cn/detail/123')).toBe(true);
    expect(weiboPageAllowed('https://evil.example/123')).toBe(false);
    expect(weiboPageAllowed('http://weibo.com/1234567890/AbCdEf')).toBe(false);
  });

  it('按用户+条目稳定选一张：同一输入结果固定，落在范围内', () => {
    const images = ['a', 'b', 'c'];
    const first = weiboPickImage(images, 'user-1', 'update-1');
    expect(first).not.toBeNull();
    expect(weiboPickImage(images, 'user-1', 'update-1')).toBe(first);
    expect(images).toContain(first);
    expect(weiboPickImage([], 'user-1', 'update-1')).toBeNull();
  });
});
