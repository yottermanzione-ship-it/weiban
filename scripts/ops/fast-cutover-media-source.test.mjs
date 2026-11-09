import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFastCutoverMediaPath } from './fast-cutover-media-source.mjs';

test('合成根也只能读取三个媒体子目录和媒体后缀，项目配置/数据库/密钥路径均拒绝', () => {
  const root = resolve(tmpdir(), 'weiban-fast-1109-synthetic-media');
  for (const path of [
    'private/chat-media/synthetic.ogg',
    'public/generated/synthetic.PNG',
    'public/stickers/builtin/synthetic.webp',
  ])
    assert.doesNotThrow(() => assertFastCutoverMediaPath(root, resolve(root, path)));
  for (const path of [
    '.env',
    'app.sqlite',
    'private/deploy.pem',
    'private/chat-media/../../.env',
    'private/chat-media/settings.json',
    'public/generated/.hidden.png',
    'public/generated-neighbor/synthetic.png',
    'public/stickers/builtin-neighbor/synthetic.png',
  ])
    assert.throws(
      () => assertFastCutoverMediaPath(root, resolve(root, path)),
      /SOURCE_PATH_REJECTED/,
    );
});
