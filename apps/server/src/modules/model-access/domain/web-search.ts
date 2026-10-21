import { isIP } from 'node:net';
import { CharacterSearchCandidate, type WebSearchResultItem } from '@weiban/contracts';

/** 21号 §6：不向搜索供应商发送私人联系方式、健康、住址或跟踪查询。 */
export function privateSearchText(text: string): boolean {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* 非 URL 文本允许包含独立百分号。 */
  }
  const normalized = decoded.normalize('NFKC');
  const withoutDates = normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/gu, (date) =>
    Number.isNaN(Date.parse(date)) ? date : ' ',
  );
  return (
    /住址|家庭地址|实时行程|航班|酒店|恋情|绯闻|私生|偷拍|病历|身份证|手机号|电话号码|联系方式|微信号|经期|我(?:的)?(?:朋友|家人|同学|同事|邻居)|身边真人/iu.test(
      normalized,
    ) ||
    /(?:\+?\d[\s()-]*){7,}/u.test(withoutDates) ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(normalized)
  );
}

/** 不带凭据，只接受公开域名的 HTTP(S) 链接；不在本机解析或访问目标地址。 */
export function publicWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isIP(host) ||
      !host.includes('.') ||
      /\.(?:local|localhost|internal|test)$/u.test(host) ||
      host.endsWith('.localhost') ||
      raw.length > 8192
    )
      return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|spm$|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeSearchQuery(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function characterCandidates(query: string, hits: readonly WebSearchResultItem[]) {
  const seen = new Set<string>();
  return hits
    .flatMap((hit) => {
      const sourceUrl = publicWebUrl(hit.url);
      if (!sourceUrl || seen.has(sourceUrl) || privateSearchText(`${hit.title} ${hit.snippet}`))
        return [];
      seen.add(sourceUrl);
      const titleName = hit.title.split(/[_|｜]|\s[-–—]\s/u)[0]?.trim() ?? '';
      const parsed = CharacterSearchCandidate.safeParse({
        name: (titleName && [...titleName].length <= 32 ? titleName : query).slice(0, 32),
        title: hit.title,
        description: hit.snippet.slice(0, 500),
        sourceUrl,
      });
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, 5);
}
