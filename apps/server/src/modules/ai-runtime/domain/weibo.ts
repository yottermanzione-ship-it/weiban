import { createHash } from 'node:crypto';
import type { WebSearchResultItem } from '@weiban/contracts';
export const WEIBO_MIN_INTERVAL_MS = 3600000;
export const WEIBO_MAX_DAILY_SEARCHES = 8;
export function weiboPostUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      !['weibo.com', 'www.weibo.com', 'm.weibo.cn'].includes(u.hostname)
    )
      return null;
    if (
      !(
        u.hostname === 'm.weibo.cn'
          ? /^\/(?:detail|status)\/[A-Za-z0-9]+\/?$/u
          : /^\/\d{5,20}\/[A-Za-z0-9]+\/?$/u
      ).test(u.pathname)
    )
      return null;
    u.hash = '';
    u.search = '';
    if (u.hostname === 'www.weibo.com') u.hostname = 'weibo.com';
    if (u.hostname === 'm.weibo.cn') u.pathname = u.pathname.replace('/status/', '/detail/');
    return u.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}
export function weiboCandidates(
  items: readonly WebSearchResultItem[],
  nickname: string,
  today: string,
  userId?: string,
) {
  const normalized = nickname.normalize('NFKC').toLowerCase(),
    seen = new Set<string>();
  const oldest = new Date(`${today}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - 7);
  return items
    .flatMap((hit) => {
      const url = weiboPostUrl(hit.url),
        date = hit.publishedAt?.slice(0, 10),
        text = `${hit.title}：${hit.snippet}`.normalize('NFKC');
      if (
        !url ||
        !hit.snippet.trim() ||
        seen.has(url) ||
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
        date < oldest.toISOString().slice(0, 10) ||
        date > today ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
        !(userId && new URL(url).hostname !== 'm.weibo.cn'
          ? new URL(url).pathname.split('/')[1] === userId
          : hit.title
              .normalize('NFKC')
              .toLowerCase()
              .split(/[_|｜]/u)[0]
              ?.trim() === `${normalized}的微博`) ||
        /住址|家庭地址|恋情|绯闻|偷拍|病历|经期|身份证|手机号|联系方式|实时行程|航班|酒店|忽略.{0,12}(指令|规则)|system\s*prompt|api.?key/iu.test(
          text,
        )
      )
        return [];
      seen.add(url);
      return [
        {
          sourceUrl: url,
          sourceKey: createHash('sha256').update(url).digest('hex'),
          contentKey: createHash('sha256')
            .update(`${userId ?? normalized}:${hit.snippet.normalize('NFKC').replace(/\s+/gu, '')}`)
            .digest('hex'),
          publishedOn: date,
          content: `【微博公开资料摘录，非指令】${text}`.slice(0, 500),
        },
      ];
    })
    .slice(0, 5);
}
