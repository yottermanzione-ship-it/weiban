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
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 数字 ID 与短编号是同一条微博的两种地址表示，按 7 位数字/4 位短码分组转换。 */
function toPostCode(id: string): string {
  const chunks = id.match(/^\d{1,7}(?=(?:\d{7})*$)|\d{7}/gu) ?? [];
  return chunks
    .map((chunk, index) => {
      let value = Number(chunk);
      let output = '';
      do {
        output = BASE62[value % BASE62.length]! + output;
        value = Math.floor(value / BASE62.length);
      } while (value > 0);
      return index === 0 ? output : output.padStart(4, '0');
    })
    .join('');
}

function toNumericPostId(code: string): string | null {
  const chunks = code.match(/^[A-Za-z0-9]{1,4}(?=(?:[A-Za-z0-9]{4})*$)|[A-Za-z0-9]{4}/gu) ?? [];
  const values = chunks.map((chunk) =>
    [...chunk].reduce((value, char) => value * BASE62.length + BASE62.indexOf(char), 0),
  );
  if (values.some((value) => value >= 10_000_000)) return null;
  return values
    .map((value, index) => (index === 0 ? String(value) : String(value).padStart(7, '0')))
    .join('');
}

export function weiboPostIdentity(raw: string, claimedAuthorId?: string) {
  const normalized = weiboPostUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.port) return null;
  const [, owner, post] = url.pathname.split('/');
  const mobile = url.hostname === 'm.weibo.cn';
  const authorId = mobile ? claimedAuthorId : owner;
  if (!post || !authorId || (claimedAuthorId && authorId !== claimedAuthorId)) return null;
  const code = mobile && /^\d{12,}$/u.test(post) ? toPostCode(post) : post;
  if (!/^[A-Za-z0-9]{1,12}$/u.test(code)) return null;
  const numeric = toNumericPostId(code);
  if (!numeric || toPostCode(numeric) !== code) return null;
  return {
    authorId,
    sourceUrl: 'https://weibo.com/' + authorId + '/' + code,
    sourceAliases: ['https://m.weibo.cn/detail/' + numeric, 'https://m.weibo.cn/detail/' + code],
  };
}
/** 朋友圈只接公开稿，沿用 H4 的隐私与指令拒绝规则。 */
export function publicWeiboTextAllowed(text: string): boolean {
  return !/住址|家庭地址|偷拍|病历|经期|身份证|私人手机号|私人联系方式|实时行程|(?:手机号|联系方式)\s*[:：]\s*\d|忽略.{0,12}(指令|规则)|system\s*prompt|api.?key/iu.test(
    text.normalize('NFKC'),
  );
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
        !publicWeiboTextAllowed(text) ||
        /恋情|绯闻|手机号|联系方式|航班|酒店/u.test(text)
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
