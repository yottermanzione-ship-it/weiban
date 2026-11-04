/**
 * 公开资料标识（T-20261104e，docs/refactor/24-character-search.md「索引和身份」：
 * 实体键来自经核实的公开资料标识或平台人工关联）。
 *
 * 只认几类百科 / 资料站「一页一个条目」的地址，从 URL 结构里取出稳定的条目编号或条目标题：
 *   baike:<百度百科义项编号>、sogou:<搜狗百科编号>、baikecom:<快懂百科编号>、
 *   wiki:<zh|en|ja>:<维基百科条目标题>、wikidata:Q<编号>、douban:<celebrity|personage>:<编号>、
 *   bangumi:<character|person|subject>:<编号>、moegirl:<萌娘百科条目标题>。
 * 不看网页正文、不看名字、不联网。消歧义页、搜索页、分类页、特殊页一律不算标识。
 *
 * 用法：同一标识 = 同一个公开资料条目，可以合并成一项；不同标识（哪怕名字一样）不自动合并，
 * 只有后台人工关联（合并实体）才算同一个人。平台人工建的实体键是 manual:<uuid>。
 *
 * model-access（站外候选结构化）和 characters（后台实体关联）共用，所以放在平台内核。
 */

import { isIP } from 'node:net';

/** 实体键 / 标识的最大长度（契约 entityKey max 120）。 */
export const PUBLIC_IDENTIFIER_MAX = 120;

const WIKI_LANGS = new Set(['zh', 'en', 'ja']);
/** 维基 / 萌娘的非条目命名空间（含中文译名）。 */
const WIKI_NAMESPACE =
  /^(?:special|category|file|image|wikipedia|help|talk|portal|template|user|draft|module|mediawiki|特殊|分类|分類|文件|檔案|帮助|幫助|讨论|討論|模板|用户|用戶|主题|主題|萌娘百科|カテゴリ|ファイル|特別|ノート|利用者)(?:[_ ]talk)?:/iu;
const DISAMBIGUATION = /消歧义|消歧義|disambiguation|曖昧さ回避|多义词/iu;

function cleanTitle(raw: string): string | null {
  let title: string;
  try {
    title = decodeURIComponent(raw);
  } catch {
    return null;
  }
  title = title.normalize('NFKC').trim().replace(/\s+/gu, '_');
  if (
    !title ||
    title.includes('/') ||
    WIKI_NAMESPACE.test(title) ||
    DISAMBIGUATION.test(title) ||
    // 控制字符、尖括号、引号不该出现在条目标题里。
    /[\p{Cc}<>"]/u.test(title)
  )
    return null;
  return title;
}

function bounded(identifier: string): string | null {
  return identifier.length <= PUBLIC_IDENTIFIER_MAX ? identifier : null;
}

/** 从公开网页地址取标识；不是认识的条目地址返回 null。 */
export function publicIdentifier(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^(?:www|m|mobile|wap)\./u, '');
  const path = url.pathname.replace(/\/+$/u, '');
  let m: RegExpExecArray | null;

  if (host === 'baike.baidu.com') {
    // /item/<名字>/<义项编号>、旧版 /subview/<a>/<编号>.htm、/view/<编号>.htm；只有名字没有编号的可能是消歧义页，不算。
    m =
      /^\/item\/[^/]+\/(\d{1,15})$/u.exec(path) ??
      /^\/subview\/\d{1,15}\/(\d{1,15})\.htm$/u.exec(path) ??
      /^\/view\/(\d{1,15})\.htm$/u.exec(path);
    return m ? `baike:${m[1]}` : null;
  }
  if (host === 'baike.sogou.com') {
    m = /^\/v(\d{1,15})\.htm$/u.exec(path);
    return m ? `sogou:${m[1]}` : null;
  }
  if (host === 'baike.com') {
    m = /^\/wikiid\/(\d{1,20})$/u.exec(path);
    return m ? `baikecom:${m[1]}` : null;
  }
  m = /^(zh|en|ja)\.(?:m\.)?wikipedia\.org$/u.exec(host);
  if (m && WIKI_LANGS.has(m[1]!)) {
    const page = /^\/(?:wiki|zh|zh-cn|zh-hans|zh-hant|zh-tw|zh-hk|zh-sg|zh-mo|zh-my)\/(.+)$/u.exec(
      path,
    );
    const title = page ? cleanTitle(page[1]!) : null;
    return title ? bounded(`wiki:${m[1]}:${title}`) : null;
  }
  if (host === 'wikidata.org') {
    m = /^\/(?:wiki|entity)\/(Q\d{1,12})$/u.exec(path);
    return m ? `wikidata:${m[1]}` : null;
  }
  if (host === 'movie.douban.com') {
    m = /^\/celebrity\/(\d{1,12})$/u.exec(path);
    return m ? `douban:celebrity:${m[1]}` : null;
  }
  if (host === 'douban.com') {
    m = /^\/personage\/(\d{1,12})$/u.exec(path);
    return m ? `douban:personage:${m[1]}` : null;
  }
  if (host === 'bgm.tv' || host === 'bangumi.tv' || host === 'chii.in') {
    m = /^\/(character|person|subject)\/(\d{1,12})$/u.exec(path);
    return m ? `bangumi:${m[1]}:${m[2]}` : null;
  }
  if (/^(?:zh\.|mzh\.)?moegirl\.org\.cn$/u.test(url.hostname.toLowerCase())) {
    const title = path.length > 1 ? cleanTitle(path.slice(1)) : null;
    return title ? bounded(`moegirl:${title}`) : null;
  }
  return null;
}

const IDENTIFIER_PATTERNS = [
  /^(?:baike|sogou):\d{1,15}$/u,
  /^baikecom:\d{1,20}$/u,
  /^wikidata:Q\d{1,12}$/u,
  /^douban:(?:celebrity|personage):\d{1,12}$/u,
  /^bangumi:(?:character|person|subject):\d{1,12}$/u,
];

/** 已经是标识格式（后台直接粘贴标识时用）。 */
export function isPublicIdentifier(text: string): boolean {
  if (text.length > PUBLIC_IDENTIFIER_MAX || /[\s\p{Cc}<>"]/u.test(text)) return false;
  if (IDENTIFIER_PATTERNS.some((re) => re.test(text))) return true;
  const wiki = /^wiki:(zh|en|ja):(.+)$/u.exec(text);
  if (wiki) return cleanTitle(wiki[2]!) === wiki[2];
  const moe = /^moegirl:(.+)$/u.exec(text);
  return !!moe && cleanTitle(moe[1]!) === moe[1];
}

/** 后台输入（标识或公开网页地址）→ 标识；都不是返回 null。 */
export function identifierFrom(input: string): string | null {
  const text = input.trim();
  if (isPublicIdentifier(text)) return text;
  return publicIdentifier(text);
}

/** 后台登记的出处：只收不带凭据的公开 HTTP(S) 地址（不收 IP、内网常见域名），不访问它。 */
export function publicSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      isIP(host) ||
      !host.includes('.') ||
      /\.(?:local|localhost|internal|test)$/u.test(host) ||
      url.toString().length > 2000
    )
      return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const MANUAL = /^manual:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** 平台人工关联的实体键。 */
export function manualEntityKey(id: string): string {
  return `manual:${id}`;
}

/** 合法实体键：公开资料标识，或平台人工关联的 manual:<uuid>。 */
export function isEntityKey(text: string): boolean {
  return MANUAL.test(text) || isPublicIdentifier(text);
}
