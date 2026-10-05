// 栅格图标从同一SVG生成，避免安卓/浏览器发布时遗漏PNG安装图标。
import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const source = await readFile(new URL('../public/icon.svg', import.meta.url));
const output = new URL('../public/generated/', import.meta.url);
await mkdir(output, { recursive: true });
for (const size of [192, 512])
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`icon-${size}.png`, output)));
