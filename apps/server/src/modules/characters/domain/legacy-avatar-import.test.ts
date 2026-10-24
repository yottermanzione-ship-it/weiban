import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  LegacyAvatarManifest,
  countAvatarInspection,
  emptyAvatarCounts,
  inspectAvatarFile,
  inspectAvatarUrl,
  parseAvatarSource,
  planAvatarSources,
  sniffAvatarMime,
} from './legacy-avatar-import.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const GIF = Buffer.from('GIF89a000000', 'latin1');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-avatar-'));
const write = (name: string, bytes: Buffer) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const pngFile = write('a.png', PNG);
const jpegFile = write('b.jfif', JPEG);
const webpFile = write('c.webp', WEBP);
const gifFile = write('d.gif', GIF);
const largeFile = write('large.png', Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES)]));

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('旧卡头像来源解析与安全检查（dry-run 纯逻辑）', () => {
  it('只认 png/jpeg/webp 文件头，不认扩展名', () => {
    expect(sniffAvatarMime(PNG)).toBe('image/png');
    expect(sniffAvatarMime(JPEG)).toBe('image/jpeg');
    expect(sniffAvatarMime(WEBP)).toBe('image/webp');
    expect(sniffAvatarMime(GIF)).toBeNull();
    expect(sniffAvatarMime(Buffer.from('short'))).toBeNull();
  });

  it('绝对路径 / http(s) URL 可识别，相对路径与带凭据 URL 拒绝', () => {
    expect(parseAvatarSource(pngFile)).toMatchObject({ kind: 'file' });
    expect(parseAvatarSource('https://legacy.example/a.png')).toMatchObject({ kind: 'url' });
    expect(parseAvatarSource('generated/avatars/a.jpg')).toBeNull();
    expect(parseAvatarSource('https://user:pass@legacy.example/a.png')).toBeNull();
    expect(parseAvatarSource('file:///tmp/a.png')).toBeNull();
  });

  it('本地文件：可导入 / 缺失 / 格式不支持 / 超大分别计数', async () => {
    const source = parseAvatarSource(pngFile)!;
    const good = await inspectAvatarFile(pngFile, source);
    expect(good).toMatchObject({ ok: true, mimeType: 'image/png', bytes: PNG.length });

    const jpeg = await inspectAvatarFile(jpegFile, parseAvatarSource(jpegFile)!);
    expect(jpeg).toMatchObject({ ok: true, mimeType: 'image/jpeg' });

    const webp = await inspectAvatarFile(webpFile, parseAvatarSource(webpFile)!);
    expect(webp).toMatchObject({ ok: true, mimeType: 'image/webp' });

    const missing = await inspectAvatarFile(
      path.join(dir, 'missing.png'),
      parseAvatarSource(path.join(dir, 'missing.png'))!,
    );
    expect(missing).toMatchObject({ ok: false, code: 'missing_file' });

    const gif = await inspectAvatarFile(gifFile, parseAvatarSource(gifFile)!);
    expect(gif).toMatchObject({ ok: false, code: 'unsupported_format' });

    const large = await inspectAvatarFile(largeFile, parseAvatarSource(largeFile)!);
    expect(large).toMatchObject({ ok: false, code: 'too_large' });

    const counts = emptyAvatarCounts();
    for (const result of [good, jpeg, webp, missing, gif, large])
      countAvatarInspection(counts, result);
    expect(counts).toMatchObject({
      importable: 3,
      missingFile: 1,
      unsupportedFormat: 1,
      tooLarge: 1,
    });
  });

  it('JSON 清单：角色 id → 来源；拒绝缺 version 或非字符串来源', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(LegacyAvatarManifest.safeParse({ version: 1, avatars: { [id]: pngFile } }).success).toBe(
      true,
    );
    expect(LegacyAvatarManifest.safeParse({ avatars: { [id]: pngFile } }).success).toBe(false);
    expect(
      LegacyAvatarManifest.safeParse({ version: 1, avatars: { [id]: { path: pngFile } } }).success,
    ).toBe(false);
  });

  it('URL：白名单主机、拒绝跳到白名单外、大小与格式错误都报告', async () => {
    const url = new URL('https://legacy.example/a.png');
    const allowed = new Set(['legacy.example']);
    const source = { kind: 'url' as const, url };

    const okFetch = vi.fn(async () => new Response(new Uint8Array(PNG), { status: 200 })) as never;
    expect(await inspectAvatarUrl(url, source, allowed, { fetchImpl: okFetch })).toMatchObject({
      ok: true,
      mimeType: 'image/png',
    });

    const redirectOut = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/a.png' },
        }),
    ) as never;
    expect(await inspectAvatarUrl(url, source, allowed, { fetchImpl: redirectOut })).toMatchObject({
      ok: false,
      code: 'url_host_not_allowed',
    });

    const redirectIn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: 'https://legacy.example/b.png' } }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array(JPEG), { status: 200 })) as never;
    expect(await inspectAvatarUrl(url, source, allowed, { fetchImpl: redirectIn })).toMatchObject({
      ok: true,
      mimeType: 'image/jpeg',
    });

    const tooLarge = vi.fn(
      async () =>
        new Response(new Uint8Array(PNG), {
          status: 200,
          headers: { 'content-length': String(AVATAR_MAX_BYTES + 1) },
        }),
    ) as never;
    expect(await inspectAvatarUrl(url, source, allowed, { fetchImpl: tooLarge })).toMatchObject({
      ok: false,
      code: 'too_large',
    });

    const gif = vi.fn(async () => new Response(new Uint8Array(GIF), { status: 200 })) as never;
    expect(await inspectAvatarUrl(url, source, allowed, { fetchImpl: gif })).toMatchObject({
      ok: false,
      code: 'unsupported_format',
    });

    const notAllowed = vi.fn() as never;
    expect(
      await inspectAvatarUrl(url, source, new Set(['other.example']), { fetchImpl: notAllowed }),
    ).toMatchObject({ ok: false, code: 'url_host_not_allowed' });
    expect(notAllowed).not.toHaveBeenCalled();
  });

  it('dry-run 规划：可导入 / 已有头像跳过 / 缺失 / 格式 / 超大 / 角色不存在计数正确', async () => {
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const idC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const idD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const idE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const idF = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const idG = '12121212-1212-4212-8212-121212121212';
    const rows = new Map([
      [idA, { avatarMediaId: null }],
      [idB, { avatarMediaId: '00000000-0000-4000-8000-000000000001' }],
      [idC, { avatarMediaId: null }],
      [idD, { avatarMediaId: null }],
      [idE, { avatarMediaId: null }],
      [idG, { avatarMediaId: null }],
    ]);
    const plan = await planAvatarSources(
      {
        [idA]: pngFile,
        [idB]: jpegFile,
        [idC]: path.join(dir, 'missing.png'),
        [idD]: gifFile,
        [idE]: largeFile,
        [idF]: pngFile,
        'not-a-uuid': pngFile,
        [idG]: 'relative/path.png',
      },
      {
        allowHosts: new Set(),
        lookup: (characterId) => rows.get(characterId) ?? null,
      },
    );
    expect(plan.counts).toMatchObject({
      total: 8,
      importable: 1,
      alreadyHasAvatar: 1,
      characterMissing: 1,
      invalidCharacterId: 1,
      missingFile: 1,
      unsupportedFormat: 1,
      tooLarge: 1,
      invalidSource: 1,
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.characterId).toBe(idA);
    expect(plan.entries.map((entry) => entry.status)).toEqual([
      'importable',
      'already_has_avatar',
      'missing_file',
      'unsupported_format',
      'too_large',
      'character_missing',
      'invalid_id',
      'invalid_source',
    ]);
  });
});
