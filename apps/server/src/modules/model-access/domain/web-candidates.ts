/**
 * 联网查找（S）候选的结构化（T-20261104e，docs/refactor/24-character-search.md 第 3 步）。纯函数，不联网、不调用模型。
 *
 * - 站外文本一律当不可信资料：只取标题、摘要里固定位置的文字，不执行、不转述其中的指令；
 *   像指令的句子（「忽略…」「你现在是…」「标记为已核实」）不会变成身份说明，实体键和「已核实」也绝不来自正文。
 * - 身份说明只从两处按固定规则摘：标题括注（「李晨（中国内地男演员）_百度百科」）、
 *   摘要首句里以候选名字开头、带职业 / 作品 / 所属词的那一段。摘不出就是 null，不编；每条都记下出处。
 * - 合并：只有同一个公开资料标识（同一个百科条目，见 platform/search/public-identity.ts）才并成一项；
 *   名字相同、头像相同都不合并。没有标识的网页各自一项（同一规范化地址只算一次）。
 * - 公开人物 / 虚构作品过滤：网页来自认识的百科条目，或标题 / 摘要里有公开身份、作品类的词；
 *   隐私词、电话、邮箱、住址、行程类的结果在这之前已被丢掉（privateSearchText）。
 */
import { createHash } from 'node:crypto';
import type { WebCharacterCandidate, WebSearchResultItem } from '@weiban/contracts';
import { publicIdentifier, searchKey } from '../../../platform/index.js';
import { privateSearchText, publicWebUrl } from './web-search.js';

/** 一次最多几个候选（与 S 一致：供应商取 5 条）。 */
export const WEB_CANDIDATE_LIMIT = 5;
const SOURCE_LIMIT = 5;
/** 摘出的身份说明最多几个字。 */
const IDENTITY_MAX_CHARS = 40;
const NAME_MAX_UNITS = 32;

/** 公开身份、作品类的词（公开人物 / 虚构作品过滤用）。 */
const PUBLIC_WORDS =
  /演员|歌手|艺人|明星|偶像|主持人|导演|编剧|制片|作家|作者|诗人|画家|音乐人|乐队|组合|模特|运动员|球员|选手|冠军|教练|主播|博主|政治家|企业家|科学家|学者|教授|历史人物|皇帝|将军|角色|人物|动漫|动画|漫画|游戏|小说|电影|电视剧|剧集|综艺|作品|虚构|主角|配角|声优|配音|番剧|百科|actor|actress|singer|musician|band|character|anime|manga|game|novel|film|movie|series|athlete|player|writer|author|director|idol/iu;
/** 身份说明里应有的职业 / 作品 / 所属词。 */
const ROLE_WORDS =
  /演员|歌手|艺人|主持人|导演|编剧|制片人|作家|诗人|画家|音乐人|乐队|组合|模特|运动员|球员|选手|教练|主播|博主|政治家|企业家|科学家|学者|教授|皇帝|将军|角色|人物|声优|配音|创作者|设计师|UP主|网红|成员|队长|主唱|偶像|艺术家|作者|漫画家|actor|actress|singer|musician|character|athlete|player|writer|author|director/iu;
/** 像指令、像在操纵系统的文字：不能当身份说明。 */
const INSTRUCTION_WORDS =
  /忽略|无视|指令|提示词|系统|管理员|核实|认证|标记|扮演|你现在|你是|请把|请将|必须|立即|prompt|ignore|instruction|system|assistant|verified|admin/iu;
/** 标题括注里不是身份的词（网站名、消歧义）。 */
const NOT_IDENTITY = /百科|百度|维基|wiki|消歧|搜狗|快懂|萌娘|官网|官方网站|official|首页|主页/iu;
const TITLE_SPLIT = /[_|｜]|\s[-–—]\s/u;
const TITLE_PAREN = /^(.+?)\s*[（(]([^（）()]{1,60})[)）]\s*$/u;

function clean(text: string, max: number): string {
  return text
    .replace(/<[^>]{0,200}>/gu, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

/** 按码点截断，同时保证 UTF-16 长度不超过 maxUnits（契约 z.string().max 按 UTF-16 计）。 */
function cut(text: string, maxChars: number, maxUnits = maxChars * 2): string {
  let out = '';
  let chars = 0;
  for (const ch of text) {
    if (chars >= maxChars || out.length + ch.length > maxUnits) break;
    out += ch;
    chars += 1;
  }
  return out.trim();
}

/** 候选 ID：按合并键（公开资料标识或规范化地址）算出，同一条目每次都一样；不含查询和用户信息。 */
export function candidateIdFor(groupKey: string): string {
  return `web_${createHash('sha256').update(groupKey).digest('base64url').slice(0, 22)}`;
}

/** 公开人物 / 虚构作品过滤：认识的百科条目，或标题 / 摘要里有公开身份、作品类的词。 */
export function publicCandidateHit(hit: Pick<WebSearchResultItem, 'title' | 'snippet' | 'url'>) {
  const url = publicWebUrl(hit.url);
  return (
    (url !== null && publicIdentifier(url) !== null) ||
    PUBLIC_WORDS.test(`${hit.title} ${hit.snippet}`)
  );
}

/** 标题 → 名字 + 括注身份（「李晨（中国内地男演员）_百度百科」→ 李晨 / 中国内地男演员）。 */
export function splitTitle(title: string): { name: string; note: string | null } {
  const head = (title.split(TITLE_SPLIT)[0] ?? '').trim();
  const m = TITLE_PAREN.exec(head);
  if (!m) return { name: head, note: null };
  const note = m[2]!.trim();
  return {
    name: m[1]!.trim(),
    note: NOT_IDENTITY.test(note) || INSTRUCTION_WORDS.test(note) ? null : cut(note, IDENTITY_MAX_CHARS),
  };
}

function acceptable(segment: string): string | null {
  const text = segment.replace(/^[是为係：:\s]+/u, '').trim();
  if (!text || !ROLE_WORDS.test(text) || INSTRUCTION_WORDS.test(text)) return null;
  if ([...text].length > IDENTITY_MAX_CHARS) return null;
  return text;
}

/**
 * 摘要 → 身份说明：只看第一句，且这句必须以候选名字开头；取第一段带职业 / 作品 / 所属词、
 * 又不像指令的文字（「李晨，1978年…出生，中国内地男演员、导演，…」→ 中国内地男演员、导演）。
 */
export function snippetIdentity(name: string, snippet: string): string | null {
  const nameKey = searchKey(name);
  if (!nameKey) return null;
  const first = (clean(snippet, 1000).split(/[。！？!?；;\n]/u)[0] ?? '').trim();
  if (!searchKey(first).startsWith(nameKey)) return null;
  const segments = first.split(/[，,]/u);
  // 第一段去掉名字（以及括注）后，剩下「是……」的部分也可以是身份。
  const head = segments[0] ?? '';
  const nameEnd = (() => {
    let consumed = '';
    for (let i = 0; i < head.length; i++) {
      consumed += head[i];
      if (searchKey(consumed) === nameKey) return i + 1;
    }
    return head.length;
  })();
  const rest = head
    .slice(nameEnd)
    .replace(/^\s*[（(][^（）()]{0,60}[)）]/u, '')
    .trim();
  const candidates = [rest, ...segments.slice(1)];
  for (const segment of candidates) {
    const found = acceptable(segment);
    if (found) return found;
  }
  return null;
}

function siteOf(source: string | null, url: string): string | null {
  const named = source ? clean(source, 200) : '';
  if (named) return named;
  try {
    return new URL(url).hostname.slice(0, 200);
  } catch {
    return null;
  }
}

/**
 * 供应商结果 → 候选（最多 5 个）。只用公开结果本身，不调用模型。
 * 名字取标题第一段（去掉括注），太长或取不出时用搜索词。
 */
export function structureCandidates(
  query: string,
  hits: readonly WebSearchResultItem[],
): WebCharacterCandidate[] {
  const groups = new Map<string, WebCharacterCandidate>();
  for (const hit of hits) {
    const url = publicWebUrl(hit.url);
    if (!url) continue;
    const title = clean(hit.title, 300);
    const snippet = clean(hit.snippet, 1000);
    if (privateSearchText(`${title} ${snippet}`)) continue;
    if (!publicCandidateHit({ title, snippet, url })) continue;
    const identifier = publicIdentifier(url);
    const groupKey = identifier ? `id:${identifier}` : `url:${url}`;
    const { name, note } = splitTitle(title);
    const titleName = cut(name, NAME_MAX_UNITS, NAME_MAX_UNITS);
    const displayName =
      titleName && [...name].length <= NAME_MAX_UNITS
        ? titleName
        : cut(query, NAME_MAX_UNITS, NAME_MAX_UNITS);
    if (!displayName) continue;
    const identity = note ?? snippetIdentity(displayName, snippet);
    const source = { url, title: title || url, site: siteOf(hit.source, url) };
    const existing = groups.get(groupKey);
    if (existing) {
      if (existing.sources.length < SOURCE_LIMIT && !existing.sources.some((s) => s.url === url))
        existing.sources.push(source);
      if (!existing.identity && identity) {
        existing.identity = identity;
        existing.identitySourceUrl = url;
      }
      continue;
    }
    if (groups.size >= WEB_CANDIDATE_LIMIT) continue;
    groups.set(groupKey, {
      candidateId: candidateIdFor(groupKey),
      name: displayName,
      title,
      description: snippet.slice(0, 500),
      identity,
      identitySourceUrl: identity ? url : null,
      sources: [source],
      identifiers: identifier ? [identifier] : [],
    });
  }
  return [...groups.values()];
}
