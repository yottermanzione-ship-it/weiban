import { describe, expect, it } from 'vitest';
import { attributionLine, verifyPostPhoto } from './post-photo.js';

const canonical = (raw: string) => {
  try {
    const url = new URL(raw);
    if (url.hostname !== 'weibo.com' && url.hostname !== 'm.weibo.cn') return null;
    if (!/^\/\d{5,20}\/[A-Za-z0-9]+$/u.test(url.pathname)) return null;
    return `https://weibo.com${url.pathname}`;
  } catch {
    return null;
  }
};
const POST = 'https://weibo.com/1234567890/AbCdEf';
const NOW = new Date('2026-10-23T08:00:00Z');
const expectation = {
  postUrl: POST,
  authorId: '1234567890',
  nickname: '林晚',
  now: NOW,
};
const page = (overrides: Record<string, string | null> = {}) => {
  const tags: Record<string, string | null> = {
    'og:url': POST,
    'article:author': 'https://weibo.com/1234567890',
    'og:image': 'https://wx1.sinaimg.cn/orj360/abc.jpg',
    'article:published_time': '2026-10-22T12:00:00Z',
    'og:description': '林晚：今天收工早，随手记一笔。',
    ...overrides,
  };
  return `<html><head>${Object.entries(tags)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `<meta property="${name}" content="${value}">`)
    .join('')}</head><body></body></html>`;
};

describe('post photo provenance', () => {
  it('accepts a post whose author, page, time, image and caption all check out', () => {
    const result = verifyPostPhoto(page(), expectation, canonical);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrl).toBe('https://wx1.sinaimg.cn/orj360/abc.jpg');
    expect(result.publishedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(result.authorId).toBe('1234567890');
    expect(result.caption).toContain('收工早');
    expect(attributionLine(result)).toContain('2026-10-22');
    expect(attributionLine(result)).toContain('非实时拍摄');
  });

  it('supports reversed attribute order and HTML entities', () => {
    const html = `<meta content="${POST}" property="og:url"><meta content="https://weibo.com/1234567890" property="article:author"><meta content="https://wx1.sinaimg.cn/a.jpg?x=1&amp;y=2" property="og:image"><meta content="2026-10-22T12:00:00Z" property="article:published_time"><meta content="林晚：测试文案" property="og:description">`;
    const result = verifyPostPhoto(html, expectation, canonical);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.imageUrl).toContain('x=1&y=2');
  });

  it('rejects a page that is not the expected post (news article or repost page)', () => {
    expect(
      verifyPostPhoto(
        page({ 'og:url': 'https://news.example.com/a.html' }),
        expectation,
        canonical,
      ),
    ).toEqual({
      ok: false,
      reason: 'page_url_mismatch',
    });
    expect(verifyPostPhoto(page({ 'og:url': null }), expectation, canonical)).toEqual({
      ok: false,
      reason: 'no_page_url',
    });
  });

  it('rejects a different person even when the page looks complete', () => {
    expect(
      verifyPostPhoto(page({ 'article:author': 'https://weibo.com/999' }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'author_mismatch',
    });
    expect(
      verifyPostPhoto(page({ 'og:description': '另一个人：今天收工早。' }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'author_mismatch',
    });
  });

  it('rejects arbitrary webpage covers and non-https images', () => {
    expect(
      verifyPostPhoto(
        page({ 'og:image': 'https://cdn.example.com/cover.jpg' }),
        expectation,
        canonical,
      ),
    ).toEqual({
      ok: false,
      reason: 'image_host_rejected',
    });
    expect(
      verifyPostPhoto(page({ 'og:image': 'http://wx1.sinaimg.cn/a.jpg' }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'image_host_rejected',
    });
    expect(
      verifyPostPhoto(page({ 'og:image': 'data:image/png;base64,AAAA' }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'image_host_rejected',
    });
  });

  it('rejects stale posts, future timestamps and unparsable dates', () => {
    expect(
      verifyPostPhoto(
        page({ 'article:published_time': '2026-10-01T00:00:00Z' }),
        expectation,
        canonical,
      ),
    ).toEqual({
      ok: false,
      reason: 'time_unverified',
    });
    expect(
      verifyPostPhoto(
        page({ 'article:published_time': '2026-10-24T00:00:00Z' }),
        expectation,
        canonical,
      ),
    ).toEqual({
      ok: false,
      reason: 'time_unverified',
    });
    expect(
      verifyPostPhoto(page({ 'article:published_time': '昨天' }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'time_unverified',
    });
    expect(
      verifyPostPhoto(page({ 'article:published_time': null }), expectation, canonical),
    ).toEqual({
      ok: false,
      reason: 'time_unverified',
    });
  });

  it('honours a caller-provided freshness window', () => {
    const html = page({ 'article:published_time': '2026-10-20T00:00:00Z' });
    expect(verifyPostPhoto(html, { ...expectation, maxAgeMs: 24 * 3_600_000 }, canonical)).toEqual({
      ok: false,
      reason: 'time_unverified',
    });
    expect(
      verifyPostPhoto(html, { ...expectation, maxAgeMs: 7 * 24 * 3_600_000 }, canonical).ok,
    ).toBe(true);
  });

  it('rejects pages without a real caption instead of inventing one', () => {
    expect(verifyPostPhoto(page({ 'og:description': '' }), expectation, canonical)).toEqual({
      ok: false,
      reason: 'no_caption',
    });
    expect(verifyPostPhoto(page({ 'og:description': '林晚' }), expectation, canonical)).toEqual({
      ok: false,
      reason: 'no_caption',
    });
  });

  it('rejects when no verified author id is available', () => {
    expect(verifyPostPhoto(page(), { ...expectation, authorId: '' }, canonical)).toEqual({
      ok: false,
      reason: 'author_mismatch',
    });
  });
});
