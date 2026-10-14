import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = new URL('../../../design-assets/stickers/old-builtin/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const apply = process.argv.includes('--apply');
const journalArg = process.argv.indexOf('--journal');
const journalPath =
  journalArg >= 0 ? process.argv[journalArg + 1] : 'old-stickers-import.local.json';
if (!journalPath) throw new Error('--journal needs a path');
const prepared = [];
for (const item of manifest.items) {
  const svg = await readFile(new URL(item.file, root));
  if (createHash('sha256').update(svg).digest('hex') !== item.sha256)
    throw new Error('素材校验失败');
  prepared.push({ ...item, png: await sharp(svg).png().toBuffer() });
}
console.log(`已校验 ${prepared.length} 张旧版基础表情并转换 PNG。`);
if (!apply) {
  console.log('离线预览完成，没有请求服务器。执行导入需 --apply。');
} else {
  try {
    const base = new URL(process.env.WEIBAN_STICKER_API_URL || 'http://127.0.0.1:9081');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
      throw new Error('API 地址无效');
    const token = process.env.WEIBAN_ADMIN_TOKEN;
    if (!token || token.length < 32) throw new Error('请通过环境变量提供已有管理员会话');
    const request = async (path, method = 'GET', body) => {
      const headers = { Authorization: `Bearer ${token}` };
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const response = await fetch(new URL(path, base), {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`素材 API 返回 HTTP ${response.status}`);
      return response.status === 204 ? null : response.json();
    };
    const uuid = (value) =>
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const catalog = await request('/api/v1/admin/stickers/packs');
    let pack = catalog.items.find((item) => item.name === manifest.packName);
    if (!pack)
      pack = await request('/api/v1/admin/stickers/packs', 'POST', {
        name: manifest.packName,
        characterIds: [],
        userVisible: true,
        enabled: true,
      });
    if (!uuid(pack.packId) || !pack.enabled || !pack.userVisible)
      throw new Error('同名表情包必须启用并对用户显示');
    let journal = { origin: base.origin, packId: pack.packId, media: {} };
    try {
      journal = JSON.parse(await readFile(journalPath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('导入记录无法读取', { cause: error });
    }
    if (journal.origin !== base.origin || journal.packId !== pack.packId)
      throw new Error('导入记录属于另一个服务器或包，请指定新的 --journal');
    let added = 0,
      skipped = 0;
    for (const item of prepared) {
      if (pack.stickers.some((entry) => entry.description === item.description)) {
        skipped++;
        continue;
      }
      let mediaId = journal.media[item.sha256];
      if (!uuid(mediaId)) {
        const form = new FormData();
        form.append(
          'file',
          new Blob([item.png], { type: 'image/png' }),
          item.file.replace('.svg', '.png'),
        );
        const media = await request('/api/v1/admin/media?purpose=sticker_library', 'POST', form);
        if (!uuid(media.mediaId)) throw new Error('上传未返回有效媒体 ID');
        mediaId = media.mediaId;
        journal.media[item.sha256] = mediaId;
        await writeFile(journalPath, JSON.stringify(journal, null, 2) + '\n');
      }
      const sticker = await request(
        `/api/v1/admin/stickers/packs/${pack.packId}/stickers`,
        'POST',
        { mediaId, description: item.description, confirmNoRealPersonPortrait: true },
      );
      if (!uuid(sticker.stickerId)) throw new Error('创建表情未返回有效 ID');
      pack.stickers.push(sticker);
      added++;
      console.log(`已导入 ${added} 张，跳过重复 ${skipped} 张。`);
    }
    console.log(`完成：新增 ${added} 张，已有 ${skipped} 张。`);
  } catch (error) {
    // Never print response bodies, signed media URLs, tokens, or raw fetch exception objects.
    console.error(
      error.message?.startsWith('素材 API')
        ? error.message
        : '导入未完成，请检查 API、已有管理员会话或导入记录；可用同一记录续跑。',
    );
    process.exitCode = 1;
  }
}

// Keep source provenance inspectable; only code-generated faces are included, no external meme packs.
