/**
 * 站内搜索结果的一句身份说明（T-20261104b；24-character-search.md「用户看到的流程」）。
 * 只用本站已审核资料：官方角色由后台录入的职业、作品出处、代表作品、一句话简介；
 * 查不到就返回 null，由客户端显示「暂未核实身份」，不编履历。
 */
const MAX_IDENTITY_CHARS = 80;

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

function work(title: string): string {
  const bare = clean(title).replace(/^《+|》+$/gu, '');
  return bare ? `《${bare}》` : '';
}

/** 新卡官方角色：职业 → 出处（虚构角色）→ 代表作品（最多 2 个）；都没有时用一句话简介。 */
export function officialIdentity(input: {
  occupation?: string | null;
  workSource?: string | null;
  works?: readonly string[];
  tagline?: string | null;
}): string | null {
  const parts: string[] = [];
  const occupation = clean(input.occupation);
  if (occupation) parts.push(clip(occupation, 30));
  const source = work(input.workSource ?? '');
  if (source) parts.push(`出自${source}`);
  const works = (input.works ?? []).map(work).filter(Boolean).slice(0, 2);
  if (works.length && !source) parts.push(`代表作品${works.join('')}`);
  if (!parts.length) {
    const tagline = clean(input.tagline);
    if (tagline) parts.push(tagline);
  }
  return parts.length ? clip(parts.join('，'), MAX_IDENTITY_CHARS) : null;
}

/** 旧卡官方角色：后台维护的签名（第一行）。 */
export function legacyIdentity(signature: string): string | null {
  const first = clean(signature.split(/\r?\n/u)[0]);
  return first ? clip(first, MAX_IDENTITY_CHARS) : null;
}

/** 本人角色的来源说明（只有本人看得到）。 */
export function ownIdentity(input: {
  originKind: string;
  originImportJobId: string | null;
  plazaAuthorName: string | null;
}): string | null {
  if (input.originKind === 'plaza_copy') {
    const author = clean(input.plazaAuthorName);
    return author ? `从广场添加 · 作者 ${clip(author, 12)}` : '从广场添加';
  }
  if (input.originImportJobId) return '从聊天记录导入';
  return null;
}
