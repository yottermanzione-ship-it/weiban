/**
 * 旧卡角色头像导入的纯逻辑：输入 JSON、来源分类、文件 / URL 安全检查、格式与大小判定。
 *
 * 安全边界与表情导入一致：只读绝对路径、拒绝符号链接 / 硬链接、按文件头认格式（扩展名不可信）、
 * URL 只允许白名单主机且不跟随重定向到白名单外。真正的加密入库在 apply 阶段由媒体服务完成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { assertNoLinks, readCheckedFile } from '../../media/index.js';

/** 头像上限：任务要求 5 MB（媒体服务本身允许 10 MB，这里取更严的值）。 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];

export const LegacyAvatarManifest = z.strictObject({
  version: z.literal(1),
  /** 允许抓取的 HTTP(S) 主机名（不含端口）；不填则 URL 来源一律拒绝。 */
  allowHosts: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
  /** 角色 id → 本地绝对路径或 http(s) URL。 */
  avatars: z.record(z.string(), z.string().trim().min(1).max(4096)),
});
export type LegacyAvatarManifest = z.infer<typeof LegacyAvatarManifest>;

export type AvatarSource = { kind: 'file'; path: string } | { kind: 'url'; url: URL };

export type AvatarInspectionCode =
  | 'missing_file'
  | 'unsupported_format'
  | 'too_large'
  | 'invalid_source'
  | 'url_host_not_allowed'
  | 'download_failed';
export type AvatarInspection =
  | { ok: true; mimeType: AvatarMimeType; bytes: number; buffer: Buffer; source: AvatarSource }
  | { ok: false; code: AvatarInspectionCode; detail?: string; source: AvatarSource };

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** 按文件头认图片格式；不信任扩展名（旧库有 .jfif 实际是 JPEG）。 */
export function sniffAvatarMime(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((value, index) => bytes[index] === value)) return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** 字符串来源：http(s) URL 或绝对文件路径。 */
export function parseAvatarSource(value: string): AvatarSource | null {
  const text = value.trim();
  if (!text) return null;
  if (/^https?:\/\//iu.test(text)) {
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return { kind: 'url', url };
    } catch {
      return null;
    }
  }
  return path.isAbsolute(text) ? { kind: 'file', path: text } : null;
}

export function allowedHostsOf(manifest: LegacyAvatarManifest): Set<string> {
  return new Set(
    (manifest.allowHosts ?? []).map((host) => host.trim().toLowerCase().replace(/\.$/u, '')),
  );
}

function hostAllowed(url: URL, allowHosts: ReadonlySet<string>): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/u, '');
  return HOST_RE.test(host) && allowHosts.has(host);
}

/** 读本地文件：拒绝链接，按大小与文件头判定；返回完整字节供 apply 入库。 */
export async function inspectAvatarFile(
  filePath: string,
  source: AvatarSource,
  maxBytes = AVATAR_MAX_BYTES,
): Promise<AvatarInspection> {
  try {
    assertNoLinks(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      code: code === 'ENOENT' ? 'missing_file' : 'invalid_source',
      detail: code ?? 'LINK_REJECTED',
      source,
    };
  }
  let size: number;
  try {
    size = fs.lstatSync(filePath).size;
  } catch {
    return { ok: false, code: 'missing_file', source };
  }
  if (size < 1 || size > maxBytes) return { ok: false, code: 'too_large', source };
  let buffer: Buffer;
  try {
    buffer = await readCheckedFile(filePath, maxBytes);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FILE_SIZE_MISMATCH_OR_LIMIT') return { ok: false, code: 'too_large', source };
    if (code === 'ENOENT') return { ok: false, code: 'missing_file', source };
    return {
      ok: false,
      code: 'invalid_source',
      detail: code ?? 'FILE_READ_FAILED',
      source,
    };
  }
  const mimeType = sniffAvatarMime(buffer);
  if (!mimeType) {
    buffer.fill(0);
    return { ok: false, code: 'unsupported_format', source };
  }
  return { ok: true, mimeType, bytes: buffer.length, buffer, source };
}

/** 抓取 URL：手动处理跳转，每一跳都校验白名单；流式读取并硬性截断到 5 MB。 */
export async function inspectAvatarUrl(
  url: URL,
  source: AvatarSource,
  allowHosts: ReadonlySet<string>,
  options: { maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AvatarInspection> {
  const maxBytes = options.maxBytes ?? AVATAR_MAX_BYTES;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    if (!hostAllowed(current, allowHosts))
      return { ok: false, code: 'url_host_not_allowed', detail: current.hostname, source };
    let response: Response;
    try {
      response = await doFetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'download_failed', source };
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, code: 'download_failed', source };
      await response.body?.cancel().catch(() => undefined);
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, code: 'download_failed', source };
      }
      continue;
    }
    if (response.status !== 200) return { ok: false, code: 'download_failed', source };
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, code: 'too_large', source };
    }
    const body = response.body;
    if (!body) return { ok: false, code: 'download_failed', source };
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, code: 'too_large', source };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, code: 'download_failed', source };
    }
    const buffer = Buffer.concat(chunks, total);
    const mimeType = sniffAvatarMime(buffer);
    if (!mimeType) {
      buffer.fill(0);
      return { ok: false, code: 'unsupported_format', source };
    }
    return {
      ok: true,
      mimeType,
      bytes: buffer.length,
      buffer,
      source: { kind: 'url', url: current },
    };
  }
  return { ok: false, code: 'download_failed', detail: 'TOO_MANY_REDIRECTS', source };
}

/** 统一入口：文件或 URL。 */
export async function inspectAvatarSource(
  source: AvatarSource,
  allowHosts: ReadonlySet<string>,
  options: { maxBytes?: number; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AvatarInspection> {
  return source.kind === 'file'
    ? inspectAvatarFile(source.path, source, options.maxBytes ?? AVATAR_MAX_BYTES)
    : inspectAvatarUrl(source.url, source, allowHosts, options);
}

export const AVATAR_ISSUE_CODES = [
  'character_id_invalid',
  'character_missing',
  'already_has_avatar',
  'missing_file',
  'unsupported_format',
  'too_large',
  'invalid_source',
  'url_host_not_allowed',
  'download_failed',
  'write_failed',
] as const;
export type AvatarIssueCode = (typeof AVATAR_ISSUE_CODES)[number];

export interface AvatarImportIssue {
  characterId: string;
  code: AvatarIssueCode;
  detail?: string;
}

export interface AvatarImportCounts {
  total: number;
  importable: number;
  imported: number;
  alreadyHasAvatar: number;
  characterMissing: number;
  invalidCharacterId: number;
  missingFile: number;
  unsupportedFormat: number;
  tooLarge: number;
  invalidSource: number;
  urlHostNotAllowed: number;
  downloadFailed: number;
  failed: number;
}

export function emptyAvatarCounts(): AvatarImportCounts {
  return {
    total: 0,
    importable: 0,
    imported: 0,
    alreadyHasAvatar: 0,
    characterMissing: 0,
    invalidCharacterId: 0,
    missingFile: 0,
    unsupportedFormat: 0,
    tooLarge: 0,
    invalidSource: 0,
    urlHostNotAllowed: 0,
    downloadFailed: 0,
    failed: 0,
  };
}

/** 把一次检查结果计入报告；`imported` 由 apply 阶段单独累加。 */
export function countAvatarInspection(
  counts: AvatarImportCounts,
  inspection: AvatarInspection,
): void {
  if (inspection.ok) {
    counts.importable++;
    return;
  }
  switch (inspection.code) {
    case 'missing_file':
      counts.missingFile++;
      break;
    case 'unsupported_format':
      counts.unsupportedFormat++;
      break;
    case 'too_large':
      counts.tooLarge++;
      break;
    case 'invalid_source':
      counts.invalidSource++;
      break;
    case 'url_host_not_allowed':
      counts.urlHostNotAllowed++;
      break;
    case 'download_failed':
      counts.downloadFailed++;
      break;
  }
}

export interface AvatarPlanEntry {
  characterId: string;
  status:
    'importable' | 'already_has_avatar' | 'character_missing' | 'invalid_id' | AvatarInspectionCode;
  mediaId?: string;
  mimeType?: AvatarMimeType;
  bytes?: number;
  detail?: string;
}

export interface AvatarPlanItem {
  characterId: string;
  inspection: Extract<AvatarInspection, { ok: true }>;
}

export interface AvatarPlan {
  counts: AvatarImportCounts;
  issues: AvatarImportIssue[];
  entries: AvatarPlanEntry[];
  items: AvatarPlanItem[];
}

/** dry-run 规划：逐条校验角色 / 来源，返回报告和可入库项；不写库。 */
export async function planAvatarSources(
  avatars: Record<string, string>,
  options: {
    allowHosts: ReadonlySet<string>;
    lookup: (characterId: string) => { avatarMediaId: string | null } | null;
    inspect?: typeof inspectAvatarSource;
    fetchImpl?: typeof fetch;
  },
): Promise<AvatarPlan> {
  const counts = emptyAvatarCounts();
  const issues: AvatarImportIssue[] = [];
  const entries: AvatarPlanEntry[] = [];
  const items: AvatarPlanItem[] = [];
  const inspect = options.inspect ?? inspectAvatarSource;
  for (const [characterId, rawSource] of Object.entries(avatars)) {
    counts.total++;
    if (!UUID_RE.test(characterId)) {
      counts.invalidCharacterId++;
      issues.push({ characterId, code: 'character_id_invalid' });
      entries.push({ characterId, status: 'invalid_id' });
      continue;
    }
    const row = options.lookup(characterId);
    if (!row) {
      counts.characterMissing++;
      issues.push({ characterId, code: 'character_missing' });
      entries.push({ characterId, status: 'character_missing' });
      continue;
    }
    if (row.avatarMediaId) {
      counts.alreadyHasAvatar++;
      entries.push({
        characterId,
        status: 'already_has_avatar',
        mediaId: row.avatarMediaId,
      });
      continue;
    }
    const source = parseAvatarSource(rawSource);
    if (!source) {
      counts.invalidSource++;
      issues.push({ characterId, code: 'invalid_source', detail: rawSource.slice(0, 120) });
      entries.push({ characterId, status: 'invalid_source' });
      continue;
    }
    const inspection = await inspect(source, options.allowHosts, {
      fetchImpl: options.fetchImpl,
    });
    countAvatarInspection(counts, inspection);
    if (!inspection.ok) {
      issues.push({
        characterId,
        code: inspection.code,
        detail: inspection.detail ?? (source.kind === 'file' ? source.path : source.url.href),
      });
      entries.push({
        characterId,
        status: inspection.code,
        detail: inspection.detail,
      });
      continue;
    }
    items.push({ characterId, inspection });
    entries.push({
      characterId,
      status: 'importable',
      mimeType: inspection.mimeType,
      bytes: inspection.bytes,
    });
  }
  return { counts, issues, entries, items };
}
